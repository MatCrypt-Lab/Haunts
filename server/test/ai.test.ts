import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cellToLatLng, latLngToCell, type AiTurn } from '@unfog/core';
import type { AiModel, BetaMessage, CreateParams } from '../src/ai/claude';
import { parseReply } from '../src/ai/agent';
import { weatherAt } from '../src/ai/geo';
import { chooseLoop, offset, scoreRoute } from '../src/ai/walks';
import { bearer, cellsNear, clock, createHarness, KORAMANGALA, newUser, postVisits, resetData, type Harness } from './helpers';

// ---------------------------------------------------------------- fakes

type Block = BetaMessage['content'][number];
const queue: { stop: BetaMessage['stop_reason']; content: Block[] }[] = [];
const requests: CreateParams[] = [];
const fakeAi: AiModel = {
  model: 'fake',
  create: async (params) => {
    requests.push(structuredClone(params));
    const next = queue.shift();
    if (!next) throw new Error('fake AI: no scripted response');
    return { id: 'm', type: 'message', role: 'assistant', model: 'fake', content: next.content, stop_reason: next.stop, stop_sequence: null, usage: {} } as unknown as BetaMessage;
  },
};
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input }) as unknown as Block;
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Block;
const json = (v: unknown) => text(JSON.stringify(v));

const cafe = { type: 'node', id: 42, lat: 12.9356, lon: 77.6249, tags: { name: 'Third Wave Coffee', amenity: 'cafe', opening_hours: 'Mo-Su 08:00-23:00', internet_access: 'wlan' } };
const fakeFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes('overpass')) return new Response(JSON.stringify({ elements: [cafe] }));
  throw new Error(`unexpected fetch ${u}`);
}) as typeof fetch;

let h: Harness;
let failingAi = false;
const ai: AiModel = { model: 'fake', create: (p) => (failingAi ? Promise.reject(new Error('down')) : fakeAi.create(p)) };

beforeAll(async () => (h = await createHarness({ ai, fetch: fakeFetch })));
afterAll(async () => {
  await h.app.close();
  await h.db.end();
});
beforeEach(async () => {
  await resetData(h.db);
  queue.length = 0;
  requests.length = 0;
  failingAi = false;
});

const cell = latLngToCell(KORAMANGALA);
const localTime = '2026-10-14T11:30:00+05:30';

async function post(token: string, url: string, payload: unknown) {
  return h.app.inject({ method: 'POST', url, headers: bearer(token), payload: payload as Record<string, unknown> });
}

// ---------------------------------------------------------------- companion

describe('AI companion', () => {
  it('pauses for phone tools, resumes with their results, and answers with real places', async () => {
    const u = await newUser(h.app, 'asha');
    queue.push({ stop: 'tool_use', content: [toolUse('t1', 'search_places', { category: 'cafe', query: '', radius_m: 800, limit: 5 })] });
    queue.push({ stop: 'tool_use', content: [toolUse('t2', 'check_visited', { place_ids: ['n42'] })] });
    queue.push({ stop: 'end_turn', content: [json({ message: 'Try Third Wave Coffee.', place_ids: ['n42'], route_ids: [], itinerary: [], suggestions: ['Plan a walk there'] })] });

    const r1 = await post(u.token, '/ai/chat', { message: 'quiet cafe with wifi I have not been to', cell, localTime });
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json() as AiTurn;
    expect(t1.reply).toBeNull();
    expect(t1.pending).toEqual([{ id: 't2', name: 'check_visited', input: { places: [{ id: 'n42', name: 'Third Wave Coffee', lat: 12.9356, lng: 77.6249 }] } }]);
    // The model saw the block's context, not coordinates.
    expect(JSON.stringify(requests[0]!.messages)).toContain(cell);
    expect(JSON.stringify(requests[0]!.messages)).not.toContain('12.935');

    const r2 = await post(u.token, '/ai/chat/tool-results', { state: t1.state, results: [{ id: 't2', output: '[{"id":"n42","visited":false}]' }] });
    expect(r2.statusCode).toBe(200);
    const t2 = r2.json() as AiTurn;
    expect(t2.reply?.message).toBe('Try Third Wave Coffee.');
    expect(t2.places.map((p) => p.name)).toEqual(['Third Wave Coffee']);
    expect(t2.places[0]!.openingHours).toBe('Mo-Su 08:00-23:00');
    // The phone's answer went back to the model as the tool result.
    const last = requests[2]!.messages.at(-1)!;
    expect(JSON.stringify(last.content)).toContain('"tool_use_id":"t2"');
  });

  it('rejects edited, foreign and mismatched state', async () => {
    const a = await newUser(h.app, 'asha');
    const b = await newUser(h.app, 'bilal');
    queue.push({ stop: 'tool_use', content: [toolUse('t1', 'taste_profile', {})] });
    const t = (await post(a.token, '/ai/chat', { message: 'what do I like', localTime })).json() as AiTurn;

    const [body, mac] = t.state.split('.');
    const edited = Buffer.from(Buffer.from(body!, 'base64url').toString().replace('taste_profile', 'game_status')).toString('base64url');
    expect((await post(a.token, '/ai/chat/tool-results', { state: `${edited}.${mac}`, results: [{ id: 't1', output: 'x' }] })).json().error).toBe('invalid_state');
    expect((await post(b.token, '/ai/chat/tool-results', { state: t.state, results: [{ id: 't1', output: 'x' }] })).json().error).toBe('invalid_state');
    expect((await post(a.token, '/ai/chat/tool-results', { state: t.state, results: [{ id: 'nope', output: 'x' }] })).json().error).toBe('tool_results_mismatch');
  });

  it('turns tool failures into tool errors instead of failing the request', async () => {
    const u = await newUser(h.app, 'asha');
    queue.push({ stop: 'tool_use', content: [toolUse('t1', 'get_weather', {})] });
    queue.push({ stop: 'end_turn', content: [json({ message: 'Weather is unavailable.', place_ids: [], route_ids: [], itinerary: [], suggestions: [] })] });
    const r = await post(u.token, '/ai/chat', { message: 'will it rain', cell, localTime });
    expect(r.statusCode).toBe(200);
    const result = JSON.stringify(requests[1]!.messages.at(-1)!.content);
    expect(result).toContain('"is_error":true');
  });

  it('is off without a model', async () => {
    const off = await createHarness({ ai: null });
    const u = await newUser(off.app, 'asha');
    const r = await off.app.inject({ method: 'POST', url: '/ai/chat', headers: bearer(u.token), payload: { message: 'hi', localTime } });
    expect(r.statusCode).toBe(503);
    expect((await off.app.inject({ method: 'GET', url: '/ai/status', headers: bearer(u.token) })).json()).toEqual({ enabled: false, model: null });
    await off.app.close();
    await off.db.end();
    h = await createHarness({ ai, fetch: fakeFetch }); // the schema was recreated
  });
});

// ---------------------------------------------------------------- moderation and quests

describe('AI features', () => {
  it('blocks drops the moderator rejects and fails open when it is down', async () => {
    const u = await newUser(h.app, 'asha');
    await postVisits(h.app, u.token, [{ cell, day: '2026-10-14' }]);
    queue.push({ stop: 'end_turn', content: [json({ allowed: false, reason: 'No phone numbers in drops.' })] });
    const blocked = await post(u.token, '/drops', { cell, title: 'Call me 9876543210' });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().message).toBe('No phone numbers in drops.');

    failingAi = true;
    expect((await post(u.token, '/drops', { cell, title: 'Best filter coffee' })).statusCode).toBe(200);
  });

  it('writes quests once a day and tracks progress live', async () => {
    const u = await newUser(h.app, 'asha');
    queue.push({ stop: 'end_turn', content: [json({ quests: [{ title: 'Fresh ground', description: 'Paint 5 new blocks today.' }, { title: 'Go east', description: 'Paint 10 blocks next door.' }] })] });
    const get = () => h.app.inject({ method: 'GET', url: '/ai/quests', headers: bearer(u.token) });
    const q1 = (await get()).json();
    expect(q1.quests[0]).toMatchObject({ kind: 'new_blocks', title: 'Fresh ground', target: 5, progress: 0, done: false });

    await postVisits(h.app, u.token, cellsNear(KORAMANGALA, 6).map((c) => ({ cell: c, day: '2026-10-14' })));
    const q2 = (await get()).json();
    expect(q2.quests[0]).toMatchObject({ progress: 5, done: true });
    expect(requests).toHaveLength(1); // cached for the day

    clock.set('2026-10-15T06:00:00Z');
    queue.push({ stop: 'end_turn', content: [json({ quests: [{ title: 'Again', description: 'More blocks.' }] })] });
    expect((await get()).json().day).toBe('2026-10-15');
  });
});

// ---------------------------------------------------------------- pure helpers

describe('AI helpers', () => {
  it('points explore loops at unexplored ground and drops', () => {
    const start = KORAMANGALA;
    // Everything north and east is explored; south-west is new.
    const explored = new Set<string>();
    for (let b = 0; b < 360; b += 5) {
      for (let d = 50; d < 1200; d += 40) {
        const p = offset(start, d, b);
        if (p.lat >= start.lat || p.lng >= start.lng) explored.add(latLngToCell(p));
      }
    }
    const plan = chooseLoop(start, 30, explored, []);
    for (const w of plan.waypoints) expect(w.lat < start.lat || w.lng < start.lng).toBe(true);
    expect(plan.newCells).toBeGreaterThan(5);

    const drop = offset(start, 500, 90);
    const withDrop = chooseLoop(start, 30, new Set(), [drop]);
    expect(withDrop.drops).toBe(1);
  });

  it('scores a route by the unexplored blocks and drops on it', () => {
    const a = KORAMANGALA;
    const b = offset(a, 300, 90);
    const coords: [number, number][] = [[a.lng, a.lat], [b.lng, b.lat]];
    const firstCell = latLngToCell(a);
    const dropCell = latLngToCell(b);
    const s = scoreRoute(coords, new Set([firstCell]), new Set([dropCell]));
    expect(s.dropsOnRoute).toBe(1);
    expect(s.newBlocks).toBeGreaterThan(1);
    expect(cellToLatLng(dropCell)).toBeTruthy();
  });

  it('reads replies defensively', () => {
    expect(parseReply('not json').message).toBe('not json');
    expect(parseReply('{"message":"hi","place_ids":["a",3],"suggestions":["x","y","z","w"]}')).toMatchObject({ message: 'hi', placeIds: ['a'], suggestions: ['x', 'y', 'z'] });
  });

  it('finds when rain starts', async () => {
    const now = new Date('2026-10-14T10:20:00Z');
    const f = (async () =>
      new Response(
        JSON.stringify({
          current: { temperature_2m: 24.4, precipitation: 0, weather_code: 3 },
          hourly: { time: ['2026-10-14T10:00', '2026-10-14T11:00', '2026-10-14T12:00'], precipitation_probability: [10, 70, 90] },
        }),
      )) as unknown as typeof fetch;
    expect(await weatherAt(f, { lat: 1.23, lng: 4.56 }, now)).toEqual({ tempC: 24, condition: 'overcast', rainingNow: false, rainChanceNext3h: 90, rainInMinutes: 40 });
  });
});
