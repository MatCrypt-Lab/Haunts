import {
  addDays,
  currentStreak,
  getCity,
  getCityStats,
  getNeighbourhood,
  monthRange,
  weekStart,
  type NeighbourhoodProgress,
  type Recap,
  type Stats,
  type Title,
} from '@unfog/core';
import type { Db } from '../db';
import { pct } from '../util';
import { dayStartInstant, type UserContext } from './context';
import { getTerritory } from './territory';

export async function getStats(db: Db, ctx: UserContext): Promise<Stats> {
  const [total, week, days, nbs] = await Promise.all([
    db.query<{ n: number }>('SELECT count(*)::int AS n FROM user_cells WHERE user_id = $1', [ctx.userId]),
    db.query<{ n: number }>(
      'SELECT coalesce(sum(cell_days), 0)::int AS n FROM user_days WHERE user_id = $1 AND day >= $2',
      [ctx.userId, weekStart(ctx.today)],
    ),
    db.query<{ day: string }>(
      'SELECT day FROM user_days WHERE user_id = $1 AND day >= $2 AND cell_days > 0',
      [ctx.userId, addDays(ctx.today, -400)],
    ),
    db.query<{ neighbourhood_id: string; cells: number }>(
      'SELECT neighbourhood_id, cells FROM user_neighbourhoods WHERE user_id = $1 AND city_id = $2',
      [ctx.userId, ctx.cityId],
    ),
  ]);

  const city = getCity(ctx.cityId);
  let cityBlock: Stats['city'] = null;
  const neighbourhoods: NeighbourhoodProgress[] = [];
  if (city) {
    const cs = getCityStats(city.id);
    let explored = 0;
    for (const r of nbs.rows) {
      const n = getNeighbourhood(city, r.neighbourhood_id);
      const t = cs.cellsByNeighbourhood[r.neighbourhood_id] ?? 0;
      explored += r.cells;
      if (n) neighbourhoods.push({ id: n.id, name: n.name, explored: r.cells, total: t, pct: pct(r.cells, t) });
    }
    neighbourhoods.sort((a, b) => b.pct - a.pct || b.explored - a.explored);
    cityBlock = { id: city.id, name: city.name, explored, total: cs.totalCells, pct: pct(explored, cs.totalCells) };
  }

  return {
    totalCells: total.rows[0]!.n,
    today: ctx.today,
    weekCellDays: week.rows[0]!.n,
    streakDays: currentStreak(
      days.rows.map((r) => r.day),
      ctx.today,
    ),
    city: cityBlock,
    neighbourhoods,
  };
}

function nbName(cityId: string, id: string): string {
  const city = getCity(cityId);
  return (city && getNeighbourhood(city, id)?.name) ?? id;
}

export async function getTitles(db: Db, ctx: UserContext): Promise<Title[]> {
  const titles: Title[] = [];

  const pioneers = await db.query<{ city_id: string; neighbourhood_id: string }>(
    'SELECT city_id, neighbourhood_id FROM neighbourhood_pioneers WHERE user_id = $1 ORDER BY achieved_at',
    [ctx.userId],
  );
  for (const p of pioneers.rows) {
    titles.push({ kind: 'pioneer', neighbourhoodId: p.neighbourhood_id, neighbourhoodName: nbName(p.city_id, p.neighbourhood_id) });
  }

  if (ctx.crewId) {
    const territory = await getTerritory(db, ctx.cityId, ctx.today, ctx.crewId);
    for (const n of territory.neighbourhoods) {
      if (n.owner?.crewId === ctx.crewId) {
        titles.push({ kind: 'territory', neighbourhoodId: n.id, neighbourhoodName: n.name, crewName: n.owner.name });
      }
    }
  }

  // Local legend: most presence in a neighbourhood this month (ties share the title).
  const { start, endExclusive } = monthRange(ctx.today.slice(0, 7));
  const legends = await db.query<{ neighbourhood_id: string }>(
    `WITH s AS (
       SELECT user_id, neighbourhood_id, sum(cell_days) AS score
       FROM neighbourhood_days
       WHERE city_id = $1 AND day >= $2 AND day < $3
       GROUP BY user_id, neighbourhood_id
     ), r AS (
       SELECT user_id, neighbourhood_id, rank() OVER (PARTITION BY neighbourhood_id ORDER BY score DESC) AS rk FROM s
     )
     SELECT neighbourhood_id FROM r WHERE user_id = $4 AND rk = 1 ORDER BY neighbourhood_id`,
    [ctx.cityId, start, endExclusive, ctx.userId],
  );
  for (const l of legends.rows) {
    titles.push({ kind: 'local_legend', neighbourhoodId: l.neighbourhood_id, neighbourhoodName: nbName(ctx.cityId, l.neighbourhood_id) });
  }
  return titles;
}

export async function getRecap(db: Db, ctx: UserContext, month: string): Promise<Recap> {
  const { start, endExclusive } = monthRange(month);
  const [cells, days, drops, cityCells, top, pioneered] = await Promise.all([
    db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_cells WHERE user_id = $1 AND first_day >= $2 AND first_day < $3',
      [ctx.userId, start, endExclusive],
    ),
    db.query<{ cell_days: number; active: number }>(
      `SELECT coalesce(sum(cell_days), 0)::int AS cell_days, count(*) FILTER (WHERE cell_days > 0)::int AS active
       FROM user_days WHERE user_id = $1 AND day >= $2 AND day < $3`,
      [ctx.userId, start, endExclusive],
    ),
    db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM drop_finds WHERE user_id = $1 AND found_at >= $2 AND found_at < $3',
      [ctx.userId, dayStartInstant(start, ctx.tzOffsetMinutes), dayStartInstant(endExclusive, ctx.tzOffsetMinutes)],
    ),
    db.query<{ before: number; after: number }>(
      `SELECT count(*) FILTER (WHERE first_day < $3)::int AS before, count(*) FILTER (WHERE first_day < $4)::int AS after
       FROM user_cells WHERE user_id = $1 AND city_id = $2`,
      [ctx.userId, ctx.cityId, start, endExclusive],
    ),
    db.query<{ neighbourhood_id: string; cell_days: number }>(
      `SELECT neighbourhood_id, sum(cell_days)::int AS cell_days FROM neighbourhood_days
       WHERE user_id = $1 AND city_id = $2 AND day >= $3 AND day < $4
       GROUP BY neighbourhood_id ORDER BY cell_days DESC, neighbourhood_id LIMIT 5`,
      [ctx.userId, ctx.cityId, start, endExclusive],
    ),
    db.query<{ city_id: string; neighbourhood_id: string }>(
      'SELECT city_id, neighbourhood_id FROM neighbourhood_pioneers WHERE user_id = $1 AND achieved_at >= $2 AND achieved_at < $3',
      [ctx.userId, dayStartInstant(start, ctx.tzOffsetMinutes), dayStartInstant(endExclusive, ctx.tzOffsetMinutes)],
    ),
  ]);

  const city = getCity(ctx.cityId);
  const total = city ? getCityStats(city.id).totalCells : 0;
  return {
    month,
    newCells: cells.rows[0]!.n,
    cellDays: days.rows[0]!.cell_days,
    activeDays: days.rows[0]!.active,
    dropsFound: drops.rows[0]!.n,
    city: city
      ? { id: city.id, name: city.name, pctStart: pct(cityCells.rows[0]!.before, total), pctEnd: pct(cityCells.rows[0]!.after, total) }
      : null,
    topNeighbourhoods: top.rows.map((r) => ({ id: r.neighbourhood_id, name: nbName(ctx.cityId, r.neighbourhood_id), cellDays: r.cell_days })),
    pioneered: pioneered.rows.map((r) => ({ id: r.neighbourhood_id, name: nbName(r.city_id, r.neighbourhood_id) })),
  };
}
