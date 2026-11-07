import { createHmac, timingSafeEqual } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import {
  cellDisk,
  cellToLatLng,
  getCity,
  getNeighbourhood,
  latLngToCell,
  placeForCell,
  PHONE_TOOLS,
  type AiPhoneCall,
  type AiPlace,
  type AiReply,
  type AiRoute,
  type AiTurn,
  type CellId,
  type LatLng,
  type PhoneToolName,
} from '@unfog/core';
import type { Db } from '../db';
import { badRequest, HttpError } from '../errors';
import type { UserContext } from '../services/context';
import { DROP_ACTIVE_SQL } from '../services/drops-map';
import { getStats } from '../services/stats';
import { getTerritory } from '../services/territory';
import { arr, int, obj, str, textOf, type AiModel, type BetaMessageParam } from './claude';
import { PLACE_CATEGORIES, searchPlaces, walkingRoute, weatherAt, type Fetcher, type PlaceCategory } from './geo';
import { chooseLoop, scoreRoute } from './walks';

type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

// ---------------------------------------------------------------- conversation state

/**
 * Everything the agent needs between turns. The phone holds it, signed, so the server stores
 * no conversations. It is bound to one user and expires.
 */
export type AgentState = {
  v: 1;
  userId: string;
  at: number;
  origin: LatLng | null;
  messages: BetaMessageParam[];
  /** Server tool results waiting for the phone's results from the same model turn. */
  held: ToolResult[];
  waitingFor: { id: string; name: PhoneToolName }[];
  places: Record<string, AiPlace>;
  routes: Record<string, AiRoute>;
  nextRoute: number;
};

const STATE_MAX_AGE_MS = 6 * 3_600_000;

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function sealState(secret: string, s: AgentState): string {
  const body = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export function openState(secret: string, token: string, userId: string, now = Date.now()): AgentState {
  const [body, mac] = token.split('.');
  const expected = body ? sign(secret, body) : '';
  if (!body || !mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    throw badRequest('invalid_state', 'This conversation cannot be continued. Start a new one.');
  }
  const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AgentState;
  if (s.v !== 1 || s.userId !== userId || now - s.at > STATE_MAX_AGE_MS) {
    throw badRequest('invalid_state', 'This conversation has expired. Start a new one.');
  }
  return s;
}

// ---------------------------------------------------------------- prompt and tools

const SYSTEM = `You are the AI companion inside Haunts, a Bengaluru city app. Haunts has two halves:
- Memory: the phone privately records where the user stops and for how long. It never leaves the phone.
- The game: the city map starts black and fills in hex blocks (about 60 m wide) as the user walks. Crews of friends compete for neighbourhoods each week, and drops are hidden in blocks for whoever walks into them.

You help with anything about the city and the user's life in it: finding places nearby, planning outings and walks, answering questions about their own history, identifying things in photos, translating signs and menus, and playing the game well.

How to work:
- Use real data from your tools. Never invent places, opening hours, distances or numbers. If a tool fails, say so briefly and offer what you can.
- The user's location is only known to the nearest map block, and only when they shared it with their message. Searches and routes start from there.
- Prefer places the user has not been to when they want something new: check with check_visited.
- Tools whose description says "runs on the user's phone" read private memory. The phone asks the user for permission and may decline; if it does, carry on without it and do not ask again in this conversation. Ask only for what the question needs.
- For "what is this" photos: describe what you see, then use search_places with a short query (a name or shop sign) to match a real place nearby when that helps.
- For outings, use get_weather and opening hours, keep walking legs realistic, and build an itinerary.
- Money is in rupees (₹). Distances in metres or km. Times in 12-hour format.

Your final answer is JSON:
- message: what you say to the user. Warm, direct, under 120 words, no markdown headings. Mention place names exactly as the tools gave them.
- place_ids: ids of places to pin on the map, best first. Only ids returned by tools.
- route_ids: ids of routes to draw, from walking_route or plan_explore_walk.
- itinerary: for plans only, otherwise empty. Each stop has a time like "7:30 PM", a place_id (or "" for a non-place step), a short title and a note.
- suggestions: up to 3 short follow-ups the user might tap next, written as the user would say them.`;

const categories = Object.keys(PLACE_CATEGORIES);

function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool {
  return { name, description, strict: true, input_schema: obj(properties) as Anthropic.Beta.BetaTool['input_schema'] };
}

/** Fixed order: the tool list is part of the cached prompt prefix. */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  tool('search_places', 'Find real places near the user from OpenStreetMap. Returns ids, names, distances, opening hours and details. Use category for kinds of places, or query for a name, brand or free text.', {
    category: { type: 'string', enum: [...categories, ''], description: 'Kind of place, or "" when using query.' },
    query: { type: 'string', description: 'Name or free text, or "" when using category.' },
    radius_m: { ...int, description: 'Search radius in metres, 200 to 5000.' },
    limit: { ...int, description: 'At most this many results, 1 to 15.' },
  }),
  tool('walking_route', 'Walking route on real streets from the user through the given places in order. Returns a route id, distance and minutes.', {
    place_ids: arr(str),
    return_to_start: { type: 'boolean' },
    title: str,
  }),
  tool('get_weather', 'Current weather at the user and the chance of rain in the next three hours.', {}),
  tool('plan_explore_walk', 'Plans a loop walk from the user that paints the most never-explored map blocks and passes hidden drops. Returns a route id, new block count and drops on the route.', {
    minutes: { ...int, description: 'Walk length in minutes, 10 to 120.' },
  }),
  tool('game_status', "The user's game state: weekly score, streak, city explored, their crew, who owns the neighbourhood they are in, and the crew leaderboard.", {}),
  tool('check_visited', "Runs on the user's phone. Says which of the given places the user has been to and how often. Use before recommending something new.", {
    place_ids: arr(str),
  }),
  tool('memory_query', "Runs on the user's phone. Answers a question about the user's private history of stops. Dates are YYYY-MM-DD in the user's time zone. Use \"\" for unused fields.", {
    kind: { type: 'string', enum: ['count_visits', 'time_spent', 'last_visit', 'stops_on_day', 'top_places'] },
    place: { ...str, description: 'Place or area name to match, or "".' },
    from: { ...str, description: 'Start day, or "".' },
    to: { ...str, description: 'End day, or "".' },
  }),
  tool('taste_profile', "Runs on the user's phone. A short summary of the kinds of places and areas the user likes and when they usually go out.", {}),
  tool('saved_places', "Runs on the user's phone. The places the user has named and the places they saved to try, with categories and areas.", {}),
];

const FINAL_FORMAT = {
  type: 'json_schema' as const,
  schema: obj({
    message: str,
    place_ids: arr(str),
    route_ids: arr(str),
    itinerary: arr(obj({ time: str, place_id: str, title: str, note: str })),
    suggestions: arr(str),
  }),
};

// ---------------------------------------------------------------- server tools

export type AgentDeps = { ai: AiModel; db: Db; fetch: Fetcher; ctx: UserContext; secret: string };

function need<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`${what} is unknown. Ask the user to turn on location for Haunts.`);
  return v;
}

async function runServerTool(d: AgentDeps, s: AgentState, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_places': {
      const category = input.category && categories.includes(String(input.category)) ? (String(input.category) as PlaceCategory) : undefined;
      const query = String(input.query ?? '').trim().slice(0, 80) || undefined;
      const places = await searchPlaces(d.fetch, need(s.origin, 'Location'), {
        radiusM: Number(input.radius_m) || 1000,
        category: query ? undefined : (category ?? 'cafe'),
        query,
        limit: Math.min(Math.max(Number(input.limit) || 8, 1), 15),
      });
      for (const p of places) s.places[p.id] = p;
      return places.length ? places : 'No places found. Try a wider radius or another category.';
    }
    case 'walking_route': {
      const origin = need(s.origin, 'Location');
      const ids = (input.place_ids as string[]).slice(0, 10);
      const stops = ids.map((id) => s.places[id]).filter((p): p is AiPlace => !!p);
      if (stops.length !== ids.length) return 'Unknown place id. Use ids from search_places.';
      const points = [origin, ...stops, ...(input.return_to_start ? [origin] : [])];
      const g = await walkingRoute(d.fetch, points);
      const id = `r${s.nextRoute++}`;
      s.routes[id] = { id, title: String(input.title).slice(0, 60) || 'Walk', ...g };
      return { route_id: id, distance_m: g.distanceM, minutes: g.durationMin };
    }
    case 'get_weather':
      return weatherAt(d.fetch, need(s.origin, 'Location'));
    case 'plan_explore_walk': {
      const origin = need(s.origin, 'Location');
      const minutes = Math.min(Math.max(Number(input.minutes) || 30, 10), 120);
      const near = cellDisk(latLngToCell(origin), Math.ceil((minutes * 75) / 150) + 4);
      const explored = new Set(
        (await d.db.query<{ cell: string }>('SELECT cell FROM user_cells WHERE user_id = $1 AND cell = ANY($2)', [d.ctx.userId, near])).rows.map((r) => r.cell),
      );
      const dropCells = new Set(
        (
          await d.db.query<{ cell: string }>(
            `SELECT d.cell FROM drops d WHERE d.cell = ANY($2) AND ${DROP_ACTIVE_SQL}
               AND NOT EXISTS (SELECT 1 FROM drop_finds f WHERE f.drop_id = d.id AND f.user_id = $1)`,
            [d.ctx.userId, near],
          )
        ).rows.map((r) => r.cell),
      );
      const plan = chooseLoop(origin, minutes, explored, [...dropCells].map(cellToLatLng));
      const g = await walkingRoute(d.fetch, [origin, ...plan.waypoints, origin]);
      const score = scoreRoute(g.coordinates, explored, dropCells);
      const id = `r${s.nextRoute++}`;
      s.routes[id] = { id, title: `${minutes}-minute explore walk`, ...g, ...score };
      return { route_id: id, distance_m: g.distanceM, minutes: g.durationMin, new_blocks: score.newBlocks, hidden_drops_on_route: score.dropsOnRoute };
    }
    case 'game_status': {
      const [stats, territory] = await Promise.all([getStats(d.db, d.ctx), getTerritory(d.db, d.ctx.cityId, d.ctx.today, d.ctx.crewId)]);
      const here = s.origin ? placeForCell(latLngToCell(s.origin)) : undefined;
      const hereNb = here ? territory.neighbourhoods.find((n) => n.id === here.neighbourhoodId) : undefined;
      return {
        week_score: stats.weekCellDays,
        streak_days: stats.streakDays,
        total_blocks: stats.totalCells,
        city_explored_pct: stats.city?.pct ?? 0,
        top_neighbourhoods: stats.neighbourhoods.slice(0, 5).map((n) => ({ name: n.name, explored_pct: n.pct })),
        my_crew: territory.myCrew ? { name: territory.myCrew.name, rank: territory.myCrew.rank, owned: territory.myCrew.owned, score: territory.myCrew.score } : null,
        current_neighbourhood: hereNb
          ? { name: hereNb.name, owner: hereNb.owner?.name ?? null, owner_score: hereNb.owner?.score ?? 0, my_crew_score: hereNb.myCrewScore }
          : null,
        leaderboard: territory.leaderboard.slice(0, 5).map((r) => ({ crew: r.name, owned: r.owned, score: r.score })),
        week_ends: territory.weekEnd,
      };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/** What the phone receives for a phone tool: place ids become coordinates the phone can match. */
function phoneInput(s: AgentState, name: PhoneToolName, input: Record<string, unknown>): Record<string, unknown> {
  if (name !== 'check_visited') return input;
  const places = ((input.place_ids as string[]) ?? [])
    .slice(0, 20)
    .map((id) => s.places[id])
    .filter((p): p is AiPlace => !!p)
    .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng }));
  return { places };
}

// ---------------------------------------------------------------- the loop

const MAX_MODEL_CALLS = 8;

function isPhoneTool(name: string): name is PhoneToolName {
  return (PHONE_TOOLS as readonly string[]).includes(name);
}

function contextLine(ctx: UserContext, localTime: string, origin: LatLng | null, cell: CellId | undefined): string {
  const place = cell ? placeForCell(cell) : undefined;
  const city = place ? getCity(place.cityId) : undefined;
  const nb = city && place ? getNeighbourhood(city, place.neighbourhoodId) : undefined;
  const where = origin ? `in ${nb?.name ?? 'an area'}${city ? `, ${city.name}` : ''} (map block ${cell})` : 'location not shared';
  return `[Context: local time ${localTime}; user is ${where}; city ${ctx.cityId}]`;
}

export function newState(userId: string, origin: LatLng | null): AgentState {
  return { v: 1, userId, at: Date.now(), origin, messages: [], held: [], waitingFor: [], places: {}, routes: {}, nextRoute: 1 };
}

/** Adds the user's message and runs the agent until it answers or needs the phone. */
export async function chat(
  d: AgentDeps,
  s: AgentState,
  msg: { text: string; localTime: string; cell?: CellId; image?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } },
): Promise<AiTurn> {
  if (s.waitingFor.length) throw badRequest('tool_results_pending', 'Send the phone tool results first.');
  if (msg.cell) s.origin = cellToLatLng(msg.cell);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (msg.image) content.push({ type: 'image', source: { type: 'base64', media_type: msg.image.mediaType, data: msg.image.data } });
  content.push({ type: 'text', text: `${contextLine(d.ctx, msg.localTime, s.origin, msg.cell)}\n${msg.text}` });
  s.messages.push({ role: 'user', content });
  return run(d, s);
}

/** Continues after the phone ran the tools it was asked to. */
export async function continueWithResults(d: AgentDeps, s: AgentState, results: { id: string; output: string; isError?: boolean }[]): Promise<AiTurn> {
  const byId = new Map(results.map((r) => [r.id, r]));
  if (!s.waitingFor.length || s.waitingFor.some((w) => !byId.has(w.id))) {
    throw badRequest('tool_results_mismatch', 'Results do not match the tools that were asked for.');
  }
  const phone: ToolResult[] = s.waitingFor.map((w) => {
    const r = byId.get(w.id)!;
    return { type: 'tool_result', tool_use_id: w.id, content: r.output.slice(0, 12_000), is_error: r.isError ?? false };
  });
  s.messages.push({ role: 'user', content: [...s.held, ...phone] });
  s.held = [];
  s.waitingFor = [];
  return run(d, s);
}

async function run(d: AgentDeps, s: AgentState): Promise<AiTurn> {
  for (let i = 0; i < MAX_MODEL_CALLS; i++) {
    const res = await d.ai.create({ max_tokens: 16_000, system: SYSTEM, tools: TOOLS, messages: s.messages, output_config: { format: FINAL_FORMAT } });
    s.messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason === 'refusal') return finish(d, s, { message: "I can't help with that one.", placeIds: [], routeIds: [], itinerary: [], suggestions: [] });
    if (res.stop_reason === 'max_tokens') throw new HttpError(502, 'ai_truncated', 'The answer got too long. Try a narrower question.');
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason !== 'tool_use') return finish(d, s, parseReply(textOf(res)));

    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const serverCalls = calls.filter((c) => !isPhoneTool(c.name));
    const phoneCalls = calls.filter((c) => isPhoneTool(c.name));
    const results = await Promise.all(
      serverCalls.map(async (c): Promise<ToolResult> => {
        try {
          const out = await runServerTool(d, s, c.name, c.input as Record<string, unknown>);
          return { type: 'tool_result', tool_use_id: c.id, content: typeof out === 'string' ? out : JSON.stringify(out) };
        } catch (err) {
          return { type: 'tool_result', tool_use_id: c.id, content: err instanceof Error ? err.message : 'Tool failed', is_error: true };
        }
      }),
    );
    if (phoneCalls.length) {
      s.held = results;
      s.waitingFor = phoneCalls.map((c) => ({ id: c.id, name: c.name as PhoneToolName }));
      const pending: AiPhoneCall[] = phoneCalls.map((c) => ({ id: c.id, name: c.name as PhoneToolName, input: phoneInput(s, c.name as PhoneToolName, c.input as Record<string, unknown>) }));
      return { reply: null, places: [], routes: [], pending, state: seal(d, s) };
    }
    s.messages.push({ role: 'user', content: results });
  }
  throw new HttpError(502, 'ai_loop', 'That took too many steps. Try a simpler question.');
}

export function parseReply(text: string): AiReply {
  try {
    const j = JSON.parse(text) as { message?: unknown; place_ids?: unknown; route_ids?: unknown; itinerary?: unknown; suggestions?: unknown };
    const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
    return {
      message: typeof j.message === 'string' ? j.message : text,
      placeIds: strings(j.place_ids, 15),
      routeIds: strings(j.route_ids, 3),
      itinerary: Array.isArray(j.itinerary)
        ? j.itinerary.slice(0, 12).map((x: Record<string, unknown>) => ({ time: String(x.time ?? ''), placeId: String(x.place_id ?? ''), title: String(x.title ?? ''), note: String(x.note ?? '') }))
        : [],
      suggestions: strings(j.suggestions, 3),
    };
  } catch {
    return { message: text, placeIds: [], routeIds: [], itinerary: [], suggestions: [] };
  }
}

function finish(d: AgentDeps, s: AgentState, reply: AiReply): AiTurn {
  const ids = [...reply.placeIds, ...reply.itinerary.map((x) => x.placeId)];
  const places = [...new Set(ids)].map((id) => s.places[id]).filter((p): p is AiPlace => !!p);
  const routes = reply.routeIds.map((id) => s.routes[id]).filter((r): r is AiRoute => !!r);
  return { reply, places, routes, pending: [], state: seal(d, s) };
}

function seal(d: AgentDeps, s: AgentState): string {
  s.at = Date.now();
  // Keep the state small: drop the oldest places once there are many.
  const keys = Object.keys(s.places);
  for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete s.places[k];
  return sealState(d.secret, s);
}
