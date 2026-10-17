import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, cellToLatLng, latLngToCell } from '@unfog/core';
import {
  ADMIN_KEY,
  INDIRANAGAR,
  KORAMANGALA,
  bearer,
  cellsNear,
  clock,
  createHarness,
  newUser,
  postVisits,
  resetData,
  type Harness,
} from './helpers';

let h: Harness;
beforeAll(async () => (h = await createHarness()));
afterAll(async () => {
  await h.app.close();
  await h.db.end();
});
beforeEach(() => resetData(h.db));

const admin = { 'x-admin-key': ADMIN_KEY };

async function createCrew(token: string, name: string, color = '#FF5A5F') {
  const r = await h.app.inject({ method: 'POST', url: '/crews', headers: bearer(token), payload: { name, color } });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json();
}

describe('crews', () => {
  it('creates, joins by code, and lists members', async () => {
    const a = await newUser(h.app, 'owner');
    const b = await newUser(h.app, 'friend');
    const crew = await createCrew(a.token, 'Night Owls');
    expect(crew).toMatchObject({ name: 'Night Owls', isOwner: true, maxMembers: LIMITS.crewMaxMembers });
    expect(crew.inviteCode).toMatch(/^[A-Z0-9]{6}$/);

    const joined = await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(b.token), payload: { code: crew.inviteCode.toLowerCase() } });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().members).toHaveLength(2);
    expect(joined.json().isOwner).toBe(false);

    const me = (await h.app.inject({ method: 'GET', url: '/me', headers: bearer(b.token) })).json();
    expect(me.crew).toMatchObject({ name: 'Night Owls', isOwner: false });

    const twice = await h.app.inject({ method: 'POST', url: '/crews', headers: bearer(b.token), payload: { name: 'Other', color: '#FF5A5F' } });
    expect(twice.statusCode).toBe(409);
    const bad = await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(b.token), payload: { code: 'ZZZZZZ' } });
    expect(bad.statusCode).toBe(404);
  });

  it('caps crew size', async () => {
    const owner = await newUser(h.app, 'bigowner');
    const crew = await createCrew(owner.token, 'Big');
    for (let i = 1; i < LIMITS.crewMaxMembers; i++) {
      const u = await newUser(h.app, `member${i}`);
      const r = await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(u.token), payload: { code: crew.inviteCode } });
      expect(r.statusCode).toBe(200);
    }
    const extra = await newUser(h.app, 'extra');
    const r = await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(extra.token), payload: { code: crew.inviteCode } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('crew_full');
  });

  it('hands ownership to the longest-standing member when the owner leaves', async () => {
    const a = await newUser(h.app, 'first');
    const b = await newUser(h.app, 'second');
    const c = await newUser(h.app, 'third');
    const crew = await createCrew(a.token, 'Relay');
    await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(b.token), payload: { code: crew.inviteCode } });
    await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(c.token), payload: { code: crew.inviteCode } });

    await h.app.inject({ method: 'POST', url: '/crews/leave', headers: bearer(a.token) });
    const view = (await h.app.inject({ method: 'GET', url: '/crews/mine', headers: bearer(b.token) })).json().crew;
    expect(view.isOwner).toBe(true);
    expect(view.members).toHaveLength(2);

    await h.app.inject({ method: 'POST', url: '/crews/leave', headers: bearer(b.token) });
    await h.app.inject({ method: 'POST', url: '/crews/leave', headers: bearer(c.token) });
    expect((await h.db.query('SELECT count(*)::int AS n FROM crews')).rows[0].n).toBe(0);
  });

  it('lets the owner rename, recolour, rotate the code and remove members', async () => {
    const a = await newUser(h.app, 'boss');
    const b = await newUser(h.app, 'crewmate');
    const crew = await createCrew(a.token, 'Before');
    await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(b.token), payload: { code: crew.inviteCode } });

    const notOwner = await h.app.inject({ method: 'PATCH', url: '/crews/mine', headers: bearer(b.token), payload: { name: 'Hijack' } });
    expect(notOwner.statusCode).toBe(403);

    const patched = (
      await h.app.inject({ method: 'PATCH', url: '/crews/mine', headers: bearer(a.token), payload: { name: 'After', color: '#3DDC97', rotateInviteCode: true } })
    ).json();
    expect(patched).toMatchObject({ name: 'After', color: '#3DDC97' });
    expect(patched.inviteCode).not.toBe(crew.inviteCode);

    const kick = await h.app.inject({ method: 'DELETE', url: `/crews/mine/members/${b.id}`, headers: bearer(a.token) });
    expect(kick.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/crews/mine', headers: bearer(b.token) })).json().crew).toBeNull();
  });

  it('shows the crew map with a one-day delay and marks overlaps', async () => {
    const a = await newUser(h.app, 'mapa');
    const b = await newUser(h.app, 'mapb');
    const crew = await createCrew(a.token, 'Mappers');
    await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(b.token), payload: { code: crew.inviteCode } });

    const shared = cellsNear(KORAMANGALA, 3);
    const onlyA = cellsNear(INDIRANAGAR, 2);
    await postVisits(h.app, a.token, [...shared, ...onlyA].map((cell) => ({ cell, day: '2026-10-13' })));
    await postVisits(h.app, b.token, shared.map((cell) => ({ cell, day: '2026-10-13' })));
    // Visited today: must stay hidden from the crew map until tomorrow.
    const fresh = latLngToCell({ lat: 12.95, lng: 77.6 });
    await postVisits(h.app, b.token, [{ cell: fresh, day: '2026-10-14' }]);

    const map = (await h.app.inject({ method: 'GET', url: '/crews/mine/map', headers: bearer(a.token) })).json().cells as { cell: string; members: number }[];
    const byCell = new Map(map.map((m) => [m.cell, m.members]));
    for (const c of shared) expect(byCell.get(c)).toBe(2);
    for (const c of onlyA) expect(byCell.get(c)).toBe(1);
    expect(byCell.has(fresh)).toBe(false);

    clock.set('2026-10-15T06:00:00Z');
    const next = (await h.app.inject({ method: 'GET', url: '/crews/mine/map', headers: bearer(a.token) })).json().cells as { cell: string }[];
    expect(next.some((m) => m.cell === fresh)).toBe(true);
  });
});

describe('territory', () => {
  it('gives each neighbourhood to the crew with the most presence this week', async () => {
    const a = await newUser(h.app, 'reda');
    const b = await newUser(h.app, 'blueb');
    const c = await newUser(h.app, 'bluec');
    const red = await createCrew(a.token, 'Red', '#FF5A5F');
    const blue = await createCrew(b.token, 'Blue', '#4D7CFE');
    await h.app.inject({ method: 'POST', url: '/crews/join', headers: bearer(c.token), payload: { code: blue.inviteCode } });

    const kora = cellsNear(KORAMANGALA, 30);
    const indi = cellsNear(INDIRANAGAR, 10);
    await postVisits(h.app, a.token, kora.slice(0, 20).map((cell) => ({ cell, day: '2026-10-13' })));
    await postVisits(h.app, b.token, kora.slice(0, 10).map((cell) => ({ cell, day: '2026-10-13' })));
    await postVisits(h.app, c.token, kora.slice(0, 5).map((cell) => ({ cell, day: '2026-10-14' })));
    await postVisits(h.app, c.token, indi.map((cell) => ({ cell, day: '2026-10-14' })));
    // Last week's presence must not count.
    clock.set('2026-10-08T06:00:00Z');
    await postVisits(h.app, b.token, kora.map((cell) => ({ cell, day: '2026-10-08' })));
    clock.set('2026-10-14T06:00:00Z');

    const t = (await h.app.inject({ method: 'GET', url: '/territory', headers: bearer(b.token) })).json();
    expect(t).toMatchObject({ cityId: 'blr', weekStart: '2026-10-12', weekEnd: '2026-10-18' });
    const nb = (id: string) => t.neighbourhoods.find((n: { id: string }) => n.id === id);
    expect(nb('koramangala').owner).toMatchObject({ crewId: red.id, score: 20 });
    expect(nb('koramangala').myCrewScore).toBe(15);
    expect(nb('indiranagar').owner).toMatchObject({ crewId: blue.id, score: 10 });
    expect(nb('whitefield').owner).toBeNull();
    expect(t.leaderboard.map((r: { name: string }) => r.name)).toEqual(['Blue', 'Red']);
    expect(t.myCrew).toMatchObject({ name: 'Blue', owned: 1, rank: 1 });

    const titles = (await h.app.inject({ method: 'GET', url: '/me/titles', headers: bearer(a.token) })).json().titles;
    expect(titles).toContainEqual({ kind: 'territory', neighbourhoodId: 'koramangala', neighbourhoodName: 'Koramangala', crewName: 'Red' });
    // Local legend is monthly: b's 30 cells on 8 October beat a's 20 this week.
    expect(titles.some((t: { kind: string }) => t.kind === 'local_legend')).toBe(false);
    const bTitles = (await h.app.inject({ method: 'GET', url: '/me/titles', headers: bearer(b.token) })).json().titles;
    expect(bTitles).toContainEqual({ kind: 'local_legend', neighbourhoodId: 'koramangala', neighbourhoodName: 'Koramangala' });
  });
});

describe('drops', () => {
  it('finds sponsor drops by visiting their cell, and only once', async () => {
    const u = await newUser(h.app, 'finder');
    const spot = cellToLatLng(latLngToCell(INDIRANAGAR));
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/drops',
      headers: admin,
      payload: { lat: spot.lat, lng: spot.lng, title: 'Free cold brew', kind: 'venue', sponsor: 'Third Wave' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ cityId: 'blr', neighbourhoodId: 'indiranagar' });

    const before = (await h.app.inject({ method: 'GET', url: '/drops', headers: bearer(u.token) })).json();
    expect(before.found).toHaveLength(0);
    expect(before.hidden[0]).toMatchObject({ kind: 'venue', sponsor: 'Third Wave', neighbourhoodName: 'Indiranagar' });
    expect(before.hidden[0]).not.toHaveProperty('cell');

    const visit = await postVisits(h.app, u.token, [{ cell: latLngToCell(INDIRANAGAR), day: '2026-10-14' }]);
    expect(visit.json().foundDrops).toHaveLength(1);
    expect(visit.json().foundDrops[0]).toMatchObject({ title: 'Free cold brew', sponsor: 'Third Wave', isMine: false });

    const again = await postVisits(h.app, u.token, [{ cell: latLngToCell(INDIRANAGAR), day: '2026-10-15' }]);
    expect(again.json().foundDrops).toHaveLength(0);

    const after = (await h.app.inject({ method: 'GET', url: '/drops', headers: bearer(u.token) })).json();
    expect(after.found).toHaveLength(1);
    expect(after.hidden).toHaveLength(0);
  });

  it('ignores expired or not-yet-started drops', async () => {
    const u = await newUser(h.app, 'timing');
    const p = cellToLatLng(latLngToCell(KORAMANGALA));
    await h.app.inject({
      method: 'POST',
      url: '/admin/drops',
      headers: admin,
      payload: { ...p, title: 'Old quest', kind: 'quest', sponsor: 'Brand', endsAt: '2026-10-01T00:00:00Z' },
    });
    await h.app.inject({
      method: 'POST',
      url: '/admin/drops',
      headers: admin,
      payload: { ...p, title: 'Future quest', kind: 'quest', sponsor: 'Brand', startsAt: '2027-01-01T00:00:00Z' },
    });
    const r = await postVisits(h.app, u.token, [{ cell: latLngToCell(KORAMANGALA), day: '2026-10-14' }]);
    expect(r.json().foundDrops).toHaveLength(0);
  });

  it('lets people leave drops only where they have been, with a weekly limit', async () => {
    const u = await newUser(h.app, 'dropper');
    const cells = cellsNear(KORAMANGALA, 5);
    const unvisited = await h.app.inject({ method: 'POST', url: '/drops', headers: bearer(u.token), payload: { cell: cells[0], title: 'Best dosa' } });
    expect(unvisited.statusCode).toBe(403);

    await postVisits(h.app, u.token, cells.map((cell) => ({ cell, day: '2026-10-14' })));
    for (let i = 0; i < LIMITS.communityDropsPerWeek; i++) {
      const r = await h.app.inject({ method: 'POST', url: '/drops', headers: bearer(u.token), payload: { cell: cells[i], title: `Spot ${i}` } });
      expect(r.statusCode).toBe(200);
      expect(r.json().isMine).toBe(true);
    }
    const over = await h.app.inject({ method: 'POST', url: '/drops', headers: bearer(u.token), payload: { cell: cells[4], title: 'One more' } });
    expect(over.statusCode).toBe(429);

    const outside = latLngToCell({ lat: 19.076, lng: 72.8777 });
    await postVisits(h.app, u.token, [{ cell: outside, day: '2026-10-14' }]);
    const far = await h.app.inject({ method: 'POST', url: '/drops', headers: bearer(u.token), payload: { cell: outside, title: 'Mumbai spot' } });
    expect(far.json().error).toBe('outside_city');
  });

  it('hides a community drop after enough reports and lets the creator delete it', async () => {
    const creator = await newUser(h.app, 'creator');
    const cell = latLngToCell(KORAMANGALA);
    await postVisits(h.app, creator.token, [{ cell, day: '2026-10-14' }]);
    const drop = (await h.app.inject({ method: 'POST', url: '/drops', headers: bearer(creator.token), payload: { cell, title: 'Rooftop' } })).json();

    const self = await h.app.inject({ method: 'POST', url: `/drops/${drop.id}/report`, headers: bearer(creator.token) });
    expect(self.statusCode).toBe(409);

    let last;
    for (let i = 0; i < LIMITS.dropReportsToHide; i++) {
      const r = await newUser(h.app, `reporter${i}`);
      last = (await h.app.inject({ method: 'POST', url: `/drops/${drop.id}/report`, headers: bearer(r.token) })).json();
    }
    expect(last).toEqual({ hidden: true });

    const viewer = await newUser(h.app, 'viewer');
    const list = (await h.app.inject({ method: 'GET', url: '/drops', headers: bearer(viewer.token) })).json();
    expect(list.hidden).toHaveLength(0);

    const del = await h.app.inject({ method: 'DELETE', url: `/drops/${drop.id}`, headers: bearer(creator.token) });
    expect(del.statusCode).toBe(200);
  });

  it('rejects admin calls without the key', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/admin/drops', payload: {} });
    expect(r.statusCode).toBe(403);
    const wrong = await h.app.inject({ method: 'GET', url: '/admin/stats', headers: { 'x-admin-key': 'x'.repeat(31) } });
    expect(wrong.statusCode).toBe(403);
    const ok = await h.app.inject({ method: 'GET', url: '/admin/stats', headers: admin });
    expect(ok.statusCode).toBe(200);
  });
});

describe('challenges', () => {
  it('runs a city war between teams with join codes', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: admin,
      payload: {
        name: 'Startup City Wars',
        cityId: 'blr',
        startsOn: '2026-10-12',
        endsOn: '2026-10-25',
        teams: [
          { name: 'Acme', color: '#FF5A5F' },
          { name: 'Globex', color: '#4D7CFE' },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const ch = created.json();
    const [acme, globex] = ch.teams;
    expect(acme.joinCode).toMatch(/^[A-Z0-9]{8}$/);

    const a1 = await newUser(h.app, 'acme1');
    const a2 = await newUser(h.app, 'acme2');
    const g1 = await newUser(h.app, 'globex1');
    for (const [u, code] of [[a1, acme.joinCode], [a2, acme.joinCode], [g1, globex.joinCode]] as const) {
      const r = await h.app.inject({ method: 'POST', url: '/challenges/join', headers: bearer(u.token), payload: { code } });
      expect(r.statusCode).toBe(200);
    }
    const switchTeam = await h.app.inject({ method: 'POST', url: '/challenges/join', headers: bearer(a1.token), payload: { code: globex.joinCode } });
    expect(switchTeam.statusCode).toBe(409);

    const cells = cellsNear(KORAMANGALA, 30);
    await postVisits(h.app, a1.token, cells.slice(0, 10).map((cell) => ({ cell, day: '2026-10-13' })));
    await postVisits(h.app, a2.token, cells.slice(0, 5).map((cell) => ({ cell, day: '2026-10-14' })));
    await postVisits(h.app, g1.token, cells.slice(0, 20).map((cell) => ({ cell, day: '2026-10-14' })));
    // Before the challenge started: must not count.
    clock.set('2026-10-10T06:00:00Z');
    await postVisits(h.app, a1.token, cells.map((cell) => ({ cell, day: '2026-10-10' })));
    clock.set('2026-10-14T06:00:00Z');

    const mine = (await h.app.inject({ method: 'GET', url: '/challenges/mine', headers: bearer(a1.token) })).json().challenges;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: 'Startup City Wars', status: 'live', myTeamId: acme.id });
    expect(mine[0].teams.map((t: { name: string; score: number; members: number }) => [t.name, t.score, t.members])).toEqual([
      ['Globex', 20, 1],
      ['Acme', 15, 2],
    ]);
    expect(mine[0].myTeamTop[0]).toMatchObject({ username: 'acme1', score: 10 });

    const board = (await h.app.inject({ method: 'GET', url: `/admin/challenges/${ch.id}`, headers: admin })).json();
    expect(board.teams[0]).toMatchObject({ name: 'Globex', joinCode: globex.joinCode });

    clock.set('2026-10-26T06:00:00Z');
    const late = await newUser(h.app, 'latecomer');
    const r = await h.app.inject({ method: 'POST', url: '/challenges/join', headers: bearer(late.token), payload: { code: acme.joinCode } });
    expect(r.statusCode).toBe(410);
  });
});
