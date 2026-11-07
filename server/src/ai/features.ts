import {
  addDays,
  cellToLatLng,
  getCity,
  getNeighbourhood,
  haversineMeters,
  placeForCell,
  weekStart,
  type AiCaption,
  type AiCoach,
  type AiJournal,
  type AiJournalBody,
  type AiPaper,
  type AiQuest,
  type AiQuests,
  type AiStory,
  type AiWrapped,
  type AiWrappedBody,
  type CellId,
} from '@unfog/core';
import type { Db, Queryable } from '../db';
import { notFound } from '../errors';
import type { UserContext } from '../services/context';
import { getCrewDetails } from '../services/crews';
import { DROP_ACTIVE_SQL } from '../services/drops-map';
import { getStats } from '../services/stats';
import { getTerritory } from '../services/territory';
import { arr, askJson, bool, int, obj, str, type AiModel } from './claude';
import { landmarksNear, type Fetcher } from './geo';

const VOICE = 'You write for Haunts, a Bengaluru city-exploration app for people in their late teens and twenties. Playful, specific, never cringe, no hashtags, no emoji unless asked. Use only the facts given; never invent numbers, names or history.';

// ---------------------------------------------------------------- cache

async function cacheGet<T>(db: Queryable, key: string, maxAgeMs: number): Promise<T | null> {
  const r = await db.query<{ value: T }>(`SELECT value FROM ai_cache WHERE key = $1 AND created_at > now() - ($2 || ' milliseconds')::interval`, [key, maxAgeMs]);
  return r.rows[0]?.value ?? null;
}

async function cachePut(db: Queryable, key: string, value: unknown, owner: { userId?: string; crewId?: string } = {}): Promise<void> {
  await db.query(
    `INSERT INTO ai_cache (key, user_id, crew_id, value) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, created_at = now()`,
    [key, owner.userId ?? null, owner.crewId ?? null, JSON.stringify(value)],
  );
}

/** Concurrent callers for the same key share one model call. */
const inflight = new Map<string, Promise<unknown>>();
async function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = load().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function nbName(cell: CellId): { city: string; nb: string } | null {
  const p = placeForCell(cell);
  const city = p ? getCity(p.cityId) : undefined;
  const nb = city && p ? getNeighbourhood(city, p.neighbourhoodId) : undefined;
  return city && nb ? { city: city.name, nb: nb.name } : null;
}

// ---------------------------------------------------------------- walking-guide stories

/** A short spoken story about a block, from the real places around it. Shared by everyone. */
export async function blockStory(ai: AiModel, db: Db, f: Fetcher, cell: CellId): Promise<AiStory> {
  const key = `story:${cell}`;
  const hit = await cacheGet<AiStory>(db, key, 30 * 86_400_000);
  if (hit) return hit;
  return once(key, async () => {
    const at = cellToLatLng(cell);
    const where = nbName(cell);
    const landmarks = await landmarksNear(f, at);
    const r = await askJson<{ title: string; text: string }>(ai, {
      system: `${VOICE} You are an audio walking guide. Your words are read aloud through earphones.`,
      user: `The listener just walked into a block they have never explored in ${where ? `${where.nb}, ${where.city}` : 'Bengaluru'}.
Places within 250 m, from OpenStreetMap: ${landmarks.length ? landmarks.join('; ') : 'none mapped'}.
Write a title (under 6 words) and a story of 40 to 70 words to read aloud: what this corner is like, one or two specific places worth a look, and something to notice. You may share well-known general facts about ${where?.nb ?? 'the area'}; do not invent specific history for small places.`,
      schema: obj({ title: str, text: str }),
    });
    const story = { cell, title: r.title.slice(0, 60), text: r.text.slice(0, 600) };
    await cachePut(db, key, story);
    return story;
  });
}

// ---------------------------------------------------------------- daily quests

type QuestPlan = Omit<AiQuest, 'title' | 'description' | 'progress' | 'done'>;

async function planQuests(db: Db, ctx: UserContext): Promise<{ plan: QuestPlan[]; facts: string[] }> {
  const city = getCity(ctx.cityId);
  const avg = await db.query<{ n: number }>(
    'SELECT coalesce(avg(new_cells), 0)::float AS n FROM user_days WHERE user_id = $1 AND day > $2',
    [ctx.userId, addDays(ctx.today, -14)],
  );
  const blocks = Math.min(40, Math.max(5, Math.round((avg.rows[0]!.n || 0) * 1.5)));
  const plan: QuestPlan[] = [{ id: 'blocks', kind: 'new_blocks', target: blocks, neighbourhoodId: null }];
  const facts = [`Paint ${blocks} blocks you have never been to today.`];

  if (city) {
    const mine = await db.query<{ neighbourhood_id: string; cells: number }>(
      'SELECT neighbourhood_id, cells FROM user_neighbourhoods WHERE user_id = $1 AND city_id = $2 ORDER BY cells DESC',
      [ctx.userId, ctx.cityId],
    );
    const home = getNeighbourhood(city, mine.rows[0]?.neighbourhood_id ?? '') ?? city.neighbourhoods[0]!;
    const known = new Map(mine.rows.map((r) => [r.neighbourhood_id, r.cells]));
    // The least-explored neighbourhood among the six nearest to where they spend most time.
    const target = city.neighbourhoods
      .filter((n) => n.id !== home.id)
      .sort((a, b) => haversineMeters(home, a) - haversineMeters(home, b))
      .slice(0, 6)
      .sort((a, b) => (known.get(a.id) ?? 0) - (known.get(b.id) ?? 0))[0];
    if (target) {
      plan.push({ id: `nb-${target.id}`, kind: 'neighbourhood', target: 10, neighbourhoodId: target.id });
      facts.push(`Paint 10 blocks in ${target.name} today (they have explored ${known.get(target.id) ?? 0} blocks there, it is near ${home.name}).`);
    }
    const drop = await db.query<{ neighbourhood_id: string | null }>(
      `SELECT d.neighbourhood_id FROM drops d WHERE d.city_id = $2 AND ${DROP_ACTIVE_SQL}
         AND NOT EXISTS (SELECT 1 FROM drop_finds f WHERE f.drop_id = d.id AND f.user_id = $1) LIMIT 20`,
      [ctx.userId, ctx.cityId],
    );
    const dropNb = drop.rows.map((r) => (r.neighbourhood_id ? getNeighbourhood(city, r.neighbourhood_id) : undefined)).find(Boolean);
    if (dropNb) {
      plan.push({ id: 'drop', kind: 'drop', target: 1, neighbourhoodId: dropNb.id });
      facts.push(`Find a hidden drop; one is somewhere in ${dropNb.name}.`);
    }
  }
  return { plan, facts };
}

async function questProgress(db: Db, ctx: UserContext, q: QuestPlan): Promise<number> {
  if (q.kind === 'new_blocks') {
    const r = await db.query<{ n: number }>('SELECT coalesce(new_cells, 0) AS n FROM user_days WHERE user_id = $1 AND day = $2', [ctx.userId, ctx.today]);
    return r.rows[0]?.n ?? 0;
  }
  if (q.kind === 'neighbourhood') {
    const r = await db.query<{ n: number }>(
      'SELECT cell_days AS n FROM neighbourhood_days WHERE user_id = $1 AND city_id = $2 AND neighbourhood_id = $3 AND day = $4',
      [ctx.userId, ctx.cityId, q.neighbourhoodId, ctx.today],
    );
    return r.rows[0]?.n ?? 0;
  }
  const since = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - ctx.tzOffsetMinutes * 60_000);
  const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM drop_finds WHERE user_id = $1 AND found_at >= $2', [ctx.userId, since]);
  return r.rows[0]?.n ?? 0;
}

export async function dailyQuests(ai: AiModel, db: Db, ctx: UserContext): Promise<AiQuests> {
  const key = `quests:${ctx.userId}:${ctx.today}`;
  let quests = await cacheGet<Omit<AiQuest, 'progress' | 'done'>[]>(db, key, 36 * 3_600_000);
  if (!quests) {
    quests = await once(key, async () => {
      const { plan, facts } = await planQuests(db, ctx);
      const r = await askJson<{ quests: { title: string; description: string }[] }>(ai, {
        system: VOICE,
        user: `Write today's quests for one player, in this order. Each needs a title under 32 characters and a one-sentence description under 110 characters that keeps the facts exact.\n${facts.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
        schema: obj({ quests: arr(obj({ title: str, description: str })) }),
      });
      const out = plan.map((q, i) => ({ ...q, title: r.quests[i]?.title.slice(0, 40) ?? facts[i]!, description: r.quests[i]?.description.slice(0, 160) ?? facts[i]! }));
      await cachePut(db, key, out, { userId: ctx.userId });
      return out;
    });
  }
  const withProgress = await Promise.all(
    quests.map(async (q) => {
      const progress = await questProgress(db, ctx, q);
      return { ...q, progress: Math.min(progress, q.target), done: progress >= q.target };
    }),
  );
  return { day: ctx.today, quests: withProgress };
}

// ---------------------------------------------------------------- crew coach and paper

type CrewSnapshot = { crew: string; rank: number | null; score: number; owned: string[]; contested: { name: string; owner: string | null; ownerScore: number; ours: number }[] };

async function crewSnapshot(db: Db, ctx: UserContext): Promise<{ snap: CrewSnapshot; members: { name: string; week: number }[] }> {
  if (!ctx.crewId) throw notFound('no_crew', 'Join a crew first.');
  const [t, crew] = await Promise.all([getTerritory(db, ctx.cityId, ctx.today, ctx.crewId), getCrewDetails(db, ctx.userId, ctx.crewId, ctx.today)]);
  const owned = t.neighbourhoods.filter((n) => n.owner?.crewId === ctx.crewId).map((n) => n.name);
  const contested = t.neighbourhoods
    .filter((n) => n.myCrewScore > 0 && n.owner?.crewId !== ctx.crewId)
    .sort((a, b) => (b.owner?.score ?? 0) - b.myCrewScore - ((a.owner?.score ?? 0) - a.myCrewScore))
    .slice(0, 5)
    .map((n) => ({ name: n.name, owner: n.owner?.name ?? null, ownerScore: n.owner?.score ?? 0, ours: n.myCrewScore }));
  return {
    snap: { crew: crew.name, rank: t.myCrew?.rank ?? null, score: t.myCrew?.score ?? 0, owned, contested },
    members: crew.members.map((m) => ({ name: m.displayName ?? m.username ?? 'Member', week: m.weekCellDays })),
  };
}

export async function crewCoach(ai: AiModel, db: Db, ctx: UserContext): Promise<AiCoach> {
  const key = `coach:${ctx.crewId}:${ctx.today}`;
  const hit = await cacheGet<AiCoach & { snap: CrewSnapshot }>(db, key, 6 * 3_600_000);
  if (hit) return { text: hit.text, generatedAt: hit.generatedAt };
  return once(key, async () => {
    const { snap, members } = await crewSnapshot(db, ctx);
    const yesterday = await cacheGet<{ snap: CrewSnapshot }>(db, `coach:${ctx.crewId}:${addDays(ctx.today, -1)}`, 3 * 86_400_000);
    const r = await askJson<{ text: string }>(ai, {
      system: `${VOICE} You are the crew's strategy coach for the weekly territory battle. Scores are block-days: each block a member walks counts once per day.`,
      user: `Today: ${ctx.today}. The week resets on Monday.
Crew now: ${JSON.stringify(snap)}
Members this week: ${JSON.stringify(members)}
${yesterday ? `Yesterday: ${JSON.stringify(yesterday.snap)}` : 'No data from yesterday.'}
In 2 to 4 sentences: what changed, the single best move for today (which neighbourhood to defend or take, and roughly how many block-days it needs), and who could make it. Use only these numbers.`,
      schema: obj({ text: str }),
    });
    const out = { text: r.text.slice(0, 700), generatedAt: new Date().toISOString(), snap };
    await cachePut(db, key, out, { crewId: ctx.crewId! });
    return { text: out.text, generatedAt: out.generatedAt };
  });
}

export async function crewPaper(ai: AiModel, db: Db, ctx: UserContext): Promise<AiPaper> {
  const key = `paper:${ctx.crewId}:${ctx.today}`;
  const hit = await cacheGet<AiPaper>(db, key, 12 * 3_600_000);
  if (hit) return hit;
  return once(key, async () => {
    const { snap, members } = await crewSnapshot(db, ctx);
    const t = await getTerritory(db, ctx.cityId, ctx.today, ctx.crewId);
    const week = weekStart(ctx.today);
    const r = await askJson<{ headline: string; stories: { title: string; body: string }[] }>(ai, {
      system: `${VOICE} You write the crew's weekly newspaper, a playful tabloid about their territory battle.`,
      user: `Week starting ${week}, written on ${ctx.today}.
Our crew: ${JSON.stringify(snap)}
Members this week (block-days): ${JSON.stringify(members)}
City leaderboard: ${JSON.stringify(t.leaderboard.slice(0, 6).map((x) => ({ crew: x.name, owned: x.owned, score: x.score })))}
Write a headline (under 70 characters) and exactly 3 short stories (title under 50 characters, body 1 to 3 sentences). Shout out real members by name with their real numbers. Use only these facts.`,
      schema: obj({ headline: str, stories: arr(obj({ title: str, body: str })) }),
    });
    const paper: AiPaper = { week, headline: r.headline.slice(0, 100), stories: r.stories.slice(0, 3), generatedAt: new Date().toISOString() };
    await cachePut(db, key, paper, { crewId: ctx.crewId! });
    return paper;
  });
}

// ---------------------------------------------------------------- story card caption

export async function cardCaption(ai: AiModel, db: Db, ctx: UserContext): Promise<AiCaption> {
  const key = `caption:${ctx.userId}:${ctx.today}`;
  const hit = await cacheGet<AiCaption>(db, key, 6 * 3_600_000);
  if (hit) return hit;
  return once(key, async () => {
    const stats = await getStats(db, ctx);
    const t = ctx.crewId ? await getTerritory(db, ctx.cityId, ctx.today, ctx.crewId) : null;
    const r = await askJson<{ caption: string }>(ai, {
      system: VOICE,
      user: `Write one punchy caption of at most 55 characters (it must fit two short lines) for this player's Instagram Story card.
Facts: ${JSON.stringify({
        blocksThisWeek: stats.weekCellDays,
        streakDays: stats.streakDays,
        cityExploredPct: stats.city?.pct ?? 0,
        topNeighbourhood: stats.neighbourhoods[0]?.name ?? null,
        crew: t?.myCrew ? { name: t.myCrew.name, rank: t.myCrew.rank, owned: t.myCrew.owned } : null,
      })}`,
      schema: obj({ caption: str }),
    });
    const out = { caption: r.caption.slice(0, 90) };
    await cachePut(db, key, out, { userId: ctx.userId });
    return out;
  });
}

// ---------------------------------------------------------------- private memory writing (opt-in, never stored)

export async function writeJournal(ai: AiModel, body: AiJournalBody): Promise<AiJournal> {
  const r = await askJson<AiJournal>(ai, {
    system: `${VOICE} You write a short private diary entry in the second person from someone's day of stops. It is only for them.`,
    user: `Day: ${body.day}. Stops in order: ${JSON.stringify(body.stops)}.${body.walkedKm ? ` Walked about ${body.walkedKm} km.` : ''}${body.newBlocks ? ` Explored ${body.newBlocks} new blocks.` : ''}
Write a title (under 6 words) and 60 to 120 words. Keep times and places exact; do not guess what they did there beyond what the place name implies.`,
    schema: obj({ title: str, text: str }),
  });
  return { title: r.title.slice(0, 60), text: r.text.slice(0, 1200) };
}

export async function writeWrapped(ai: AiModel, body: AiWrappedBody): Promise<AiWrapped> {
  const r = await askJson<AiWrapped>(ai, {
    system: `${VOICE} You write a person's private monthly "Wrapped" from their own place history. It is only for them.`,
    user: `Month ${body.month}: ${JSON.stringify(body)}
Write a title (under 8 words), a 60 to 100 word recap, and 3 to 5 highlight lines (each under 60 characters) built from the real numbers.`,
    schema: obj({ title: str, text: str, highlights: arr(str) }),
  });
  return { title: r.title.slice(0, 80), text: r.text.slice(0, 1000), highlights: r.highlights.slice(0, 5).map((h) => h.slice(0, 90)) };
}

// ---------------------------------------------------------------- moderation and admin

export type Moderation = { allowed: boolean; reason: string };

/** Checks a community drop before strangers see it. */
export async function moderateDrop(ai: AiModel, title: string, note: string | null): Promise<Moderation> {
  return askJson<Moderation>(ai, {
    system:
      'You moderate short public notes that users of a city app leave in the street for strangers to find, like "Best filter coffee here". Block: harassment, hate, sexual content, threats, doxxing or personal details (phone numbers, home addresses, full names of private people), scams, spam and ads with contact details, and dangerous or illegal instructions. Allow ordinary tips, jokes, opinions about places and mild slang. Text may be in any language, including Kannada, Hindi and Hinglish.',
    user: `Title: ${JSON.stringify(title)}\nNote: ${JSON.stringify(note ?? '')}\nReason: one short sentence the author will see if blocked, or "" if allowed.`,
    schema: obj({ allowed: bool, reason: str }),
    maxTokens: 2000,
  });
}

export async function questIdeas(ai: AiModel, brief: string, neighbourhood: string | null, count: number) {
  return askJson<{ ideas: { title: string; mechanic: string; reward: string; blocks: number }[] }>(ai, {
    system: `${VOICE} You design sponsored street quests for brands in Haunts. Players find drops by walking into map blocks, crews compete for neighbourhoods, and every block walked paints the map.`,
    user: `Brand brief: ${brief}\n${neighbourhood ? `Neighbourhood: ${neighbourhood}\n` : ''}Give ${count} quest ideas. Each: title, the mechanic in one or two sentences, the reward, and how many map blocks of walking it takes.`,
    schema: obj({ ideas: arr(obj({ title: str, mechanic: str, reward: str, blocks: int })) }),
  });
}
