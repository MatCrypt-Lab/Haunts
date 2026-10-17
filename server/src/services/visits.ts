import {
  LIMITS,
  addDays,
  getCity,
  getCityStats,
  getNeighbourhood,
  placeForCell,
  type CellPlace,
  type NewTitle,
  type VisitsResult,
} from '@unfog/core';
import type { Db } from '../db';
import { withTx } from '../db';
import { DROP_ACTIVE_SQL, DROP_COLUMNS, toDropDetails, type DropRow } from './drops-map';

type Visit = { cell: string; day: string };

type CellState = {
  first: string;
  last: string;
  visitDays: number;
  isNew: boolean;
  changed: boolean;
  place: CellPlace | undefined;
};

/**
 * Records visits for one user. Idempotent: re-sending the same (cell, day) pairs changes nothing.
 * A (cell, day) pair is "counted" when it adds a new day to that cell's history; counted pairs
 * feed daily presence (territory, streaks, challenges). New cells feed exploration percentages.
 */
export async function ingestVisits(db: Db, userId: string, visits: Visit[], today: string): Promise<VisitsResult> {
  const minDay = addDays(today, -LIMITS.visitMaxAgeDays);
  const maxDay = addDays(today, 1);

  const seen = new Set<string>();
  const pairs: Visit[] = [];
  for (const v of visits) {
    if (v.day < minDay || v.day > maxDay) continue;
    const k = `${v.cell}|${v.day}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push(v);
  }
  pairs.sort((a, b) => (a.day === b.day ? (a.cell < b.cell ? -1 : 1) : a.day < b.day ? -1 : 1));

  const empty: VisitsResult = { accepted: 0, newCells: 0, newCellDays: 0, foundDrops: [], newTitles: [] };
  if (pairs.length === 0) return empty;

  const cells = [...new Set(pairs.map((p) => p.cell))];
  const days = [...new Set(pairs.map((p) => p.day))];

  return withTx(db, async (tx) => {
    // Serialise uploads per user so concurrent batches cannot double count new cells.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);

    const existing = await tx.query<{ cell: string; first_day: string; last_day: string; visit_days: number; city_id: string | null; neighbourhood_id: string | null }>(
      `SELECT cell, first_day, last_day, visit_days, city_id, neighbourhood_id
       FROM user_cells WHERE user_id = $1 AND cell = ANY($2::text[])`,
      [userId, cells],
    );
    const state = new Map<string, CellState>();
    for (const r of existing.rows) {
      state.set(r.cell, {
        first: r.first_day,
        last: r.last_day,
        visitDays: r.visit_days,
        isNew: false,
        changed: false,
        place: r.city_id && r.neighbourhood_id ? { cityId: r.city_id, neighbourhoodId: r.neighbourhood_id } : undefined,
      });
    }

    const dayRows = await tx.query<{ day: string; cell_days: number }>(
      'SELECT day, cell_days FROM user_days WHERE user_id = $1 AND day = ANY($2::date[])',
      [userId, days],
    );
    const budget = new Map<string, number>(days.map((d) => [d, LIMITS.maxCellsPerDay]));
    for (const r of dayRows.rows) budget.set(r.day, LIMITS.maxCellsPerDay - r.cell_days);

    const counted: { cell: string; day: string; place: CellPlace | undefined }[] = [];
    let accepted = 0;
    for (const { cell, day } of pairs) {
      const left = budget.get(day) ?? 0;
      let st = state.get(cell);
      if (!st) {
        if (left <= 0) continue;
        st = { first: day, last: day, visitDays: 1, isNew: true, changed: true, place: placeForCell(cell) };
        state.set(cell, st);
        counted.push({ cell, day, place: st.place });
        budget.set(day, left - 1);
        accepted++;
        continue;
      }
      accepted++;
      if (day > st.last || day < st.first) {
        if (left <= 0) continue;
        if (day > st.last) st.last = day;
        else st.first = day;
        st.visitDays++;
        st.changed = true;
        counted.push({ cell, day, place: st.place });
        budget.set(day, left - 1);
      }
    }

    const changed = [...state.entries()].filter(([, s]) => s.changed);
    if (changed.length > 0) {
      await tx.query(
        `INSERT INTO user_cells (user_id, cell, city_id, neighbourhood_id, first_day, last_day, visit_days)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::date[], $6::date[], $7::int[])
         ON CONFLICT (user_id, cell) DO UPDATE SET
           first_day = EXCLUDED.first_day, last_day = EXCLUDED.last_day, visit_days = EXCLUDED.visit_days`,
        [
          userId,
          changed.map(([c]) => c),
          changed.map(([, s]) => s.place?.cityId ?? null),
          changed.map(([, s]) => s.place?.neighbourhoodId ?? null),
          changed.map(([, s]) => s.first),
          changed.map(([, s]) => s.last),
          changed.map(([, s]) => s.visitDays),
        ],
      );
    }

    // user_days: cell_days per day, and new cells by their first day.
    const perDay = new Map<string, { cellDays: number; newCells: number }>();
    for (const c of counted) {
      const e = perDay.get(c.day) ?? { cellDays: 0, newCells: 0 };
      e.cellDays++;
      perDay.set(c.day, e);
    }
    const newCellEntries = [...state.entries()].filter(([, s]) => s.isNew);
    for (const [, s] of newCellEntries) perDay.get(s.first)!.newCells++;
    if (perDay.size > 0) {
      await tx.query(
        `INSERT INTO user_days (user_id, day, cell_days, new_cells)
         SELECT $1, * FROM unnest($2::date[], $3::int[], $4::int[])
         ON CONFLICT (user_id, day) DO UPDATE SET
           cell_days = user_days.cell_days + EXCLUDED.cell_days,
           new_cells = user_days.new_cells + EXCLUDED.new_cells`,
        [userId, [...perDay.keys()], [...perDay.values()].map((v) => v.cellDays), [...perDay.values()].map((v) => v.newCells)],
      );
    }

    // user_neighbourhoods: newly explored cells per neighbourhood.
    const perNb = new Map<string, { cityId: string; nbId: string; n: number }>();
    for (const [, s] of newCellEntries) {
      if (!s.place) continue;
      const k = `${s.place.cityId}|${s.place.neighbourhoodId}`;
      const e = perNb.get(k) ?? { cityId: s.place.cityId, nbId: s.place.neighbourhoodId, n: 0 };
      e.n++;
      perNb.set(k, e);
    }
    let nbTotals: { city_id: string; neighbourhood_id: string; cells: number }[] = [];
    if (perNb.size > 0) {
      const vals = [...perNb.values()];
      const r = await tx.query<{ city_id: string; neighbourhood_id: string; cells: number }>(
        `INSERT INTO user_neighbourhoods (user_id, city_id, neighbourhood_id, cells)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[])
         ON CONFLICT (user_id, city_id, neighbourhood_id) DO UPDATE SET cells = user_neighbourhoods.cells + EXCLUDED.cells
         RETURNING city_id, neighbourhood_id, cells`,
        [userId, vals.map((v) => v.cityId), vals.map((v) => v.nbId), vals.map((v) => v.n)],
      );
      nbTotals = r.rows;
    }

    // neighbourhood_days: daily presence per neighbourhood.
    const perNbDay = new Map<string, { cityId: string; nbId: string; day: string; n: number }>();
    for (const c of counted) {
      if (!c.place) continue;
      const k = `${c.place.cityId}|${c.place.neighbourhoodId}|${c.day}`;
      const e = perNbDay.get(k) ?? { cityId: c.place.cityId, nbId: c.place.neighbourhoodId, day: c.day, n: 0 };
      e.n++;
      perNbDay.set(k, e);
    }
    if (perNbDay.size > 0) {
      const vals = [...perNbDay.values()];
      await tx.query(
        `INSERT INTO neighbourhood_days (user_id, city_id, neighbourhood_id, day, cell_days)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::date[], $5::int[])
         ON CONFLICT (user_id, city_id, neighbourhood_id, day) DO UPDATE SET
           cell_days = neighbourhood_days.cell_days + EXCLUDED.cell_days`,
        [userId, vals.map((v) => v.cityId), vals.map((v) => v.nbId), vals.map((v) => v.day), vals.map((v) => v.n)],
      );
    }

    // Pioneer titles.
    const newTitles: NewTitle[] = [];
    for (const t of nbTotals) {
      const total = getCityStats(t.city_id).cellsByNeighbourhood[t.neighbourhood_id] ?? 0;
      if (total === 0 || t.cells < Math.ceil(total * LIMITS.pioneerFraction)) continue;
      const ins = await tx.query(
        `INSERT INTO neighbourhood_pioneers (city_id, neighbourhood_id, user_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING neighbourhood_id`,
        [t.city_id, t.neighbourhood_id, userId],
      );
      if (ins.rowCount) {
        const city = getCity(t.city_id);
        newTitles.push({
          kind: 'pioneer',
          cityId: t.city_id,
          neighbourhoodId: t.neighbourhood_id,
          neighbourhoodName: (city && getNeighbourhood(city, t.neighbourhood_id)?.name) ?? t.neighbourhood_id,
        });
      }
    }

    // Drops in any visited cell that this user has not found yet.
    const acceptedCells = [...new Set(pairs.filter((p) => state.has(p.cell)).map((p) => p.cell))];
    const drops = await tx.query<DropRow>(
      `SELECT ${DROP_COLUMNS} FROM drops d
       WHERE d.cell = ANY($2::text[]) AND ${DROP_ACTIVE_SQL}
         AND NOT EXISTS (SELECT 1 FROM drop_finds f WHERE f.drop_id = d.id AND f.user_id = $1)`,
      [userId, acceptedCells],
    );
    if (drops.rows.length > 0) {
      await tx.query(
        `INSERT INTO drop_finds (drop_id, user_id) SELECT unnest($2::uuid[]), $1 ON CONFLICT DO NOTHING`,
        [userId, drops.rows.map((d) => d.id)],
      );
    }

    return {
      accepted,
      newCells: newCellEntries.length,
      newCellDays: counted.length,
      foundDrops: drops.rows.map((d) => toDropDetails(d, userId)),
      newTitles,
    };
  });
}

/**
 * Permanently removes cells from a user's map, for example after they add a privacy zone.
 * Daily totals keep their counts (they hold no locations); exploration counts are reduced.
 */
export async function forgetCells(db: Db, userId: string, cells: string[]): Promise<{ removed: number }> {
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
    const del = await tx.query<{ city_id: string | null; neighbourhood_id: string | null }>(
      'DELETE FROM user_cells WHERE user_id = $1 AND cell = ANY($2::text[]) RETURNING city_id, neighbourhood_id',
      [userId, [...new Set(cells)]],
    );
    const perNb = new Map<string, { cityId: string; nbId: string; n: number }>();
    for (const r of del.rows) {
      if (!r.city_id || !r.neighbourhood_id) continue;
      const k = `${r.city_id}|${r.neighbourhood_id}`;
      const e = perNb.get(k) ?? { cityId: r.city_id, nbId: r.neighbourhood_id, n: 0 };
      e.n++;
      perNb.set(k, e);
    }
    for (const e of perNb.values()) {
      await tx.query(
        `UPDATE user_neighbourhoods SET cells = greatest(cells - $4, 0)
         WHERE user_id = $1 AND city_id = $2 AND neighbourhood_id = $3`,
        [userId, e.cityId, e.nbId, e.n],
      );
    }
    return { removed: del.rowCount ?? 0 };
  });
}
