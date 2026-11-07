import { haversineMeters, PLACE_MATCH_RADIUS_M, type AiPhoneCall } from '@unfog/core';
import { getDb } from './local-db';

/**
 * The AI companion's phone-side tools. They read the private memory on this phone and return
 * small summaries. `shared` says in plain words what left the phone, and is shown in the chat.
 */
export type PhoneToolResult = { output: string; shared: string };

const EMOJI_KIND: Record<string, string> = {
  '☕': 'cafe', '🍜': 'food', '🍻': 'bar', '🏠': 'home', '💼': 'work', '🎓': 'college',
  '🏋️': 'gym', '🌳': 'park', '🛍️': 'shopping', '🎵': 'music', '❤️': 'favourite', '⭐': 'special',
};

type StayRow = { start_t: number; end_t: number; lat: number; lng: number; cell: string; day: string; place_id: string | null; pname: string | null; gname: string | null };
const STAYS = `SELECT s.start_t, s.end_t, s.lat, s.lng, s.cell, s.day, s.place_id, p.name AS pname, g.name AS gname
  FROM stays s LEFT JOIN places p ON p.id = s.place_id LEFT JOIN geo_names g ON g.cell = s.cell`;

const minutes = (r: StayRow) => Math.round((r.end_t - r.start_t) / 60_000);
const nameOf = (r: StayRow) => r.pname ?? r.gname ?? 'an unnamed spot';
const time = (t: number) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
/** "4th B Cross Road, Koramangala" -> "Koramangala". */
const areaOf = (name: string | null) => (name?.includes(',') ? name.split(',').pop()!.trim() : null);

async function staysBetween(from: string, to: string): Promise<StayRow[]> {
  const db = await getDb();
  return db.getAllAsync<StayRow>(`${STAYS} WHERE s.day >= ? AND s.day <= ? ORDER BY s.start_t`, [from || '0000-00-00', to || '9999-99-99']);
}

function matches(r: StayRow, place: string): boolean {
  if (!place) return true;
  const q = place.toLowerCase();
  return (r.pname ?? '').toLowerCase().includes(q) || (r.gname ?? '').toLowerCase().includes(q);
}

async function checkVisited(input: { places?: { id: string; name: string; lat: number; lng: number }[] }): Promise<PhoneToolResult> {
  const places = (input.places ?? []).slice(0, 20);
  const db = await getDb();
  const out = [];
  for (const p of places) {
    const d = 0.002; // about 200 m, then the exact check below
    const rows = await db.getAllAsync<{ lat: number; lng: number; day: string }>(
      'SELECT lat, lng, day FROM stays WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY start_t DESC',
      [p.lat - d, p.lat + d, p.lng - d, p.lng + d],
    );
    const hits = rows.filter((r) => haversineMeters(r, p) <= PLACE_MATCH_RADIUS_M);
    out.push({ id: p.id, visited: hits.length > 0, visits: hits.length, last_visit: hits[0]?.day ?? null });
  }
  return { output: JSON.stringify(out), shared: `Whether you have been to ${places.length} nearby place${places.length === 1 ? '' : 's'}` };
}

async function memoryQuery(input: { kind?: string; place?: string; from?: string; to?: string }): Promise<PhoneToolResult> {
  const place = (input.place ?? '').trim();
  const rows = (await staysBetween(input.from ?? '', input.to || input.from || '')).filter((r) => matches(r, place));
  const label = place ? `"${place}"` : 'all places';
  switch (input.kind) {
    case 'count_visits':
      return { output: JSON.stringify({ place: place || null, visits: rows.length, days: new Set(rows.map((r) => r.day)).size }), shared: `How many times you went to ${label}` };
    case 'time_spent':
      return { output: JSON.stringify({ place: place || null, minutes: rows.reduce((a, r) => a + minutes(r), 0), visits: rows.length }), shared: `Time you spent at ${label}` };
    case 'last_visit': {
      const r = rows.at(-1);
      return {
        output: JSON.stringify(r ? { place: nameOf(r), day: r.day, from: time(r.start_t), to: time(r.end_t), minutes: minutes(r) } : { found: false }),
        shared: `When you were last at ${label}`,
      };
    }
    case 'stops_on_day':
      return {
        output: JSON.stringify(rows.slice(0, 30).map((r) => ({ place: nameOf(r), day: r.day, from: time(r.start_t), to: time(r.end_t), minutes: minutes(r) }))),
        shared: `Your stops (names and times) on ${input.from || 'the days asked'}`,
      };
    case 'top_places': {
      const by = new Map<string, { visits: number; minutes: number }>();
      for (const r of rows) {
        const e = by.get(nameOf(r)) ?? { visits: 0, minutes: 0 };
        e.visits++;
        e.minutes += minutes(r);
        by.set(nameOf(r), e);
      }
      const top = [...by.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 8).map(([name, v]) => ({ place: name, ...v }));
      return { output: JSON.stringify(top), shared: 'Your most visited places and time spent' };
    }
    default:
      return { output: 'Unknown question type.', shared: 'Nothing' };
  }
}

async function tasteProfile(): Promise<PhoneToolResult> {
  const db = await getDb();
  const kinds = await db.getAllAsync<{ emoji: string | null; n: number }>(
    'SELECT p.emoji, count(s.start_t) AS n FROM places p LEFT JOIN stays s ON s.place_id = p.id GROUP BY p.emoji ORDER BY n DESC',
  );
  const wished = await db.getAllAsync<{ category: string; n: number }>('SELECT category, count(*) AS n FROM wishlist GROUP BY category ORDER BY n DESC LIMIT 5');
  const rows = await staysBetween('', '');
  const areas = new Map<string, number>();
  const parts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const r of rows) {
    const a = areaOf(r.gname);
    if (a) areas.set(a, (areas.get(a) ?? 0) + minutes(r));
    const h = new Date(r.start_t).getHours();
    parts[h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night'] += 1;
  }
  const profile = {
    favourite_kinds: kinds.filter((k) => k.emoji && EMOJI_KIND[k.emoji] && !['home', 'work'].includes(EMOJI_KIND[k.emoji]!)).slice(0, 5).map((k) => EMOJI_KIND[k.emoji!]),
    saved_to_try: wished.map((w) => w.category),
    favourite_areas: [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a]) => a),
    usually_out: Object.entries(parts).sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 0).slice(0, 2).map(([p]) => p),
    stops_recorded: rows.length,
  };
  return { output: JSON.stringify(profile), shared: 'The kinds of places and areas you like (no times or addresses)' };
}

async function savedPlaces(): Promise<PhoneToolResult> {
  const db = await getDb();
  const places = await db.getAllAsync<{ name: string; emoji: string | null; gname: string | null }>(
    `SELECT p.name, p.emoji, (SELECT g.name FROM stays s JOIN geo_names g ON g.cell = s.cell WHERE s.place_id = p.id LIMIT 1) AS gname
     FROM places p ORDER BY p.created_at DESC LIMIT 40`,
  );
  const wish = await db.getAllAsync<{ name: string; category: string }>('SELECT name, category FROM wishlist ORDER BY created_at DESC LIMIT 40');
  return {
    output: JSON.stringify({
      named_places: places.filter((p) => p.emoji !== '🏠').map((p) => ({ name: p.name, kind: p.emoji ? EMOJI_KIND[p.emoji] ?? null : null, area: areaOf(p.gname) })),
      want_to_try: wish,
    }),
    // Home is never shared, even by name.
    shared: 'The names of your saved places (not home) and places you want to try',
  };
}

export async function runPhoneTool(call: AiPhoneCall): Promise<PhoneToolResult> {
  const input = call.input as never;
  switch (call.name) {
    case 'check_visited':
      return checkVisited(input);
    case 'memory_query':
      return memoryQuery(input);
    case 'taste_profile':
      return tasteProfile();
    case 'saved_places':
      return savedPlaces();
  }
}

/** Totals for one month, for the private AI Wrapped. Names and minutes only, no times or places' positions. */
export async function monthSummary(month: string) {
  const rows = await staysBetween(`${month}-01`, `${month}-31`);
  const db = await getDb();
  const earlier = new Set(
    (await db.getAllAsync<{ cell: string }>('SELECT DISTINCT cell FROM stays WHERE day < ?', [`${month}-01`])).map((r) => r.cell),
  );
  const places = new Map<string, { visits: number; minutes: number }>();
  const areas = new Map<string, number>();
  for (const r of rows) {
    const p = places.get(nameOf(r)) ?? { visits: 0, minutes: 0 };
    p.visits++;
    p.minutes += minutes(r);
    places.set(nameOf(r), p);
    const a = areaOf(r.gname);
    if (a) areas.set(a, (areas.get(a) ?? 0) + minutes(r));
  }
  return {
    month,
    days: new Set(rows.map((r) => r.day)).size,
    stops: rows.length,
    newPlaces: new Set(rows.filter((r) => !earlier.has(r.cell)).map((r) => r.cell)).size,
    topPlaces: [...places.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 5).map(([name, v]) => ({ name: name.slice(0, 120), ...v })),
    topAreas: [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, m]) => ({ name: name.slice(0, 120), minutes: m })),
  };
}

/** New blocks first painted on a day, for the journal. */
export async function newBlocksOn(day: string): Promise<number> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM cells WHERE first_day = ?', [day]))?.n ?? 0;
}
