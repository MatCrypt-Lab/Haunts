import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, getCityStats, latLngToCell } from '@unfog/core';
import { KORAMANGALA, bearer, cellsNear, clock, createHarness, newUser, postVisits, resetData, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => (h = await createHarness()));
afterAll(async () => {
  await h.app.close();
  await h.db.end();
});
beforeEach(() => resetData(h.db));

describe('visits', () => {
  it('records new cells, is idempotent, and counts repeat days', async () => {
    const { token } = await newUser(h.app, 'walker');
    const cells = cellsNear(KORAMANGALA, 10);
    const today = cells.map((cell) => ({ cell, day: '2026-10-14' }));

    const r1 = await postVisits(h.app, token, today);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ accepted: 10, newCells: 10, newCellDays: 10 });

    const r2 = await postVisits(h.app, token, today);
    expect(r2.json()).toMatchObject({ newCells: 0, newCellDays: 0 });

    const earlier = cells.slice(0, 3).map((cell) => ({ cell, day: '2026-10-13' }));
    const r3 = await postVisits(h.app, token, earlier);
    expect(r3.json()).toMatchObject({ newCells: 0, newCellDays: 3 });

    const stats = (await h.app.inject({ method: 'GET', url: '/me/stats', headers: bearer(token) })).json();
    expect(stats.totalCells).toBe(10);
    expect(stats.weekCellDays).toBe(13);
    expect(stats.streakDays).toBe(2);
    expect(stats.city.explored).toBe(10);
    expect(stats.city.total).toBe(getCityStats('blr').totalCells);
    expect(stats.neighbourhoods[0]).toMatchObject({ id: 'koramangala', explored: 10 });
  });

  it('ignores visits outside the accepted day window', async () => {
    const { token } = await newUser(h.app, 'late');
    const cell = latLngToCell(KORAMANGALA);
    const r = await postVisits(h.app, token, [
      { cell, day: '2026-10-01' }, // too old
      { cell, day: '2026-10-20' }, // future
    ]);
    expect(r.json()).toMatchObject({ accepted: 0, newCells: 0 });
  });

  it('accepts cells outside any city but does not count them toward city progress', async () => {
    const { token } = await newUser(h.app, 'traveller');
    const mumbai = latLngToCell({ lat: 19.076, lng: 72.8777 });
    const r = await postVisits(h.app, token, [{ cell: mumbai, day: '2026-10-14' }]);
    expect(r.json().newCells).toBe(1);
    const stats = (await h.app.inject({ method: 'GET', url: '/me/stats', headers: bearer(token) })).json();
    expect(stats.totalCells).toBe(1);
    expect(stats.city.explored).toBe(0);
  });

  it('caps cells per day', async () => {
    const { token } = await newUser(h.app, 'spoofer');
    const cells = cellsNear(KORAMANGALA, LIMITS.maxCellsPerDay + 50);
    const day = '2026-10-14';
    const first = await postVisits(h.app, token, cells.slice(0, 2000).map((cell) => ({ cell, day })));
    expect(first.json().newCells).toBe(2000);
    const second = await postVisits(h.app, token, cells.slice(2000).map((cell) => ({ cell, day })));
    expect(second.json().newCells).toBe(LIMITS.maxCellsPerDay - 2000);
  });

  it('serialises concurrent uploads without double counting', async () => {
    const { token } = await newUser(h.app, 'racer');
    const visits = cellsNear(KORAMANGALA, 50).map((cell) => ({ cell, day: '2026-10-14' }));
    await Promise.all([postVisits(h.app, token, visits), postVisits(h.app, token, visits), postVisits(h.app, token, visits)]);
    const stats = (await h.app.inject({ method: 'GET', url: '/me/stats', headers: bearer(token) })).json();
    expect(stats.totalCells).toBe(50);
    expect(stats.weekCellDays).toBe(50);
    expect(stats.city.explored).toBe(50);
  });

  it('awards Pioneer to the first person to explore a quarter of a neighbourhood', async () => {
    const a = await newUser(h.app, 'pioneer');
    const b = await newUser(h.app, 'second');
    const nbTotal = getCityStats('blr').cellsByNeighbourhood['koramangala']!;
    const need = Math.ceil(nbTotal * LIMITS.pioneerFraction);
    // A disk around the anchor stays inside Koramangala for this many cells.
    const cells = cellsNear(KORAMANGALA, need);
    const visits = cells.map((cell) => ({ cell, day: '2026-10-14' }));

    const almost = await postVisits(h.app, a.token, visits.slice(0, need - 1));
    expect(almost.json().newTitles).toEqual([]);
    const done = await postVisits(h.app, a.token, visits.slice(need - 1));
    expect(done.json().newTitles).toEqual([
      { kind: 'pioneer', cityId: 'blr', neighbourhoodId: 'koramangala', neighbourhoodName: 'Koramangala' },
    ]);

    const late = await postVisits(h.app, b.token, visits);
    expect(late.json().newTitles).toEqual([]);

    const titles = (await h.app.inject({ method: 'GET', url: '/me/titles', headers: bearer(a.token) })).json().titles;
    expect(titles).toContainEqual({ kind: 'pioneer', neighbourhoodId: 'koramangala', neighbourhoodName: 'Koramangala' });
  });

  it('builds a monthly recap', async () => {
    const { token } = await newUser(h.app, 'recapper');
    const cells = cellsNear(KORAMANGALA, 20);
    clock.set('2026-09-30T06:00:00Z');
    await postVisits(h.app, token, cells.slice(0, 5).map((cell) => ({ cell, day: '2026-09-30' })));
    clock.set('2026-10-14T06:00:00Z');
    await postVisits(h.app, token, cells.map((cell) => ({ cell, day: '2026-10-14' })));

    const r = (await h.app.inject({ method: 'GET', url: '/me/recap?month=2026-10', headers: bearer(token) })).json();
    expect(r).toMatchObject({ month: '2026-10', newCells: 15, cellDays: 20, activeDays: 1 });
    expect(r.city.pctEnd).toBeGreaterThan(r.city.pctStart);
    expect(r.topNeighbourhoods[0]).toMatchObject({ id: 'koramangala', cellDays: 20 });

    const bad = await h.app.inject({ method: 'GET', url: '/me/recap?month=2026-13', headers: bearer(token) });
    expect(bad.statusCode).toBe(400);
  });

  it('returns my cells for syncing a new device', async () => {
    const { token } = await newUser(h.app, 'syncer');
    const cells = cellsNear(KORAMANGALA, 4);
    await postVisits(h.app, token, cells.map((cell) => ({ cell, day: '2026-10-14' })));
    const r = (await h.app.inject({ method: 'GET', url: '/me/cells', headers: bearer(token) })).json();
    expect(r.cells.map((c: [string, string]) => c[0]).sort()).toEqual([...cells].sort());
    expect(r.cells[0][1]).toBe('2026-10-14');
  });

  it('forgets cells on request and lowers exploration counts', async () => {
    const { token } = await newUser(h.app, 'forgetter');
    const cells = cellsNear(KORAMANGALA, 8);
    await postVisits(h.app, token, cells.map((cell) => ({ cell, day: '2026-10-14' })));
    const r = await h.app.inject({ method: 'POST', url: '/me/cells/forget', headers: bearer(token), payload: { cells: cells.slice(0, 3) } });
    expect(r.json()).toEqual({ removed: 3 });
    const stats = (await h.app.inject({ method: 'GET', url: '/me/stats', headers: bearer(token) })).json();
    expect(stats.totalCells).toBe(5);
    expect(stats.city.explored).toBe(5);
    const again = await h.app.inject({ method: 'POST', url: '/me/cells/forget', headers: bearer(token), payload: { cells: cells.slice(0, 3) } });
    expect(again.json()).toEqual({ removed: 0 });
  });

  it('validates the request body', async () => {
    const { token } = await newUser(h.app, 'badbody');
    const r = await h.app.inject({ method: 'POST', url: '/visits', headers: bearer(token), payload: { visits: [{ cell: 'x', day: 'y' }] } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_request');
  });
});
