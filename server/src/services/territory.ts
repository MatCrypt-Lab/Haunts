import { addDays, getCity, weekStart, type Territory, type TerritoryLeaderRow, type TerritoryNeighbourhood } from '@unfog/core';
import type { Queryable } from '../db';
import { notFound } from '../errors';

/**
 * Weekly territory. A crew's score in a neighbourhood is the sum of its members' daily
 * presence there (distinct cells per member per day), Monday to Sunday in city time.
 * The highest score owns the neighbourhood; ties go to the crew whose name sorts first.
 * Scores follow current crew membership.
 */
export async function getTerritory(db: Queryable, cityId: string, today: string, myCrewId: string | null): Promise<Territory> {
  const city = getCity(cityId);
  if (!city) throw notFound('unknown_city');
  const ws = weekStart(today);
  const we = addDays(ws, 6);

  const scores = await db.query<{ crew_id: string; neighbourhood_id: string; score: number }>(
    `SELECT u.crew_id, nd.neighbourhood_id, sum(nd.cell_days)::int AS score
     FROM neighbourhood_days nd JOIN users u ON u.id = nd.user_id
     WHERE nd.city_id = $1 AND nd.day BETWEEN $2 AND $3 AND u.crew_id IS NOT NULL
     GROUP BY u.crew_id, nd.neighbourhood_id`,
    [cityId, ws, we],
  );
  const crewIds = [...new Set(scores.rows.map((r) => r.crew_id))];
  const crews = new Map<string, { name: string; color: string }>();
  if (crewIds.length > 0) {
    const c = await db.query<{ id: string; name: string; color: string }>(
      'SELECT id, name, color FROM crews WHERE id = ANY($1::uuid[])',
      [crewIds],
    );
    for (const r of c.rows) crews.set(r.id, { name: r.name, color: r.color });
  }

  const byNb = new Map<string, { crewId: string; score: number }[]>();
  for (const r of scores.rows) {
    const list = byNb.get(r.neighbourhood_id) ?? [];
    list.push({ crewId: r.crew_id, score: r.score });
    byNb.set(r.neighbourhood_id, list);
  }

  const tally = new Map<string, { owned: number; score: number }>();
  for (const r of scores.rows) {
    const t = tally.get(r.crew_id) ?? { owned: 0, score: 0 };
    t.score += r.score;
    tally.set(r.crew_id, t);
  }

  const neighbourhoods: TerritoryNeighbourhood[] = city.neighbourhoods.map((n) => {
    const list = (byNb.get(n.id) ?? []).filter((x) => x.score > 0 && crews.has(x.crewId));
    list.sort(
      (a, b) =>
        b.score - a.score ||
        crews.get(a.crewId)!.name.localeCompare(crews.get(b.crewId)!.name) ||
        a.crewId.localeCompare(b.crewId),
    );
    const top = list[0];
    if (top) tally.get(top.crewId)!.owned++;
    return {
      id: n.id,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      owner: top ? { crewId: top.crewId, name: crews.get(top.crewId)!.name, color: crews.get(top.crewId)!.color, score: top.score } : null,
      myCrewScore: myCrewId ? (list.find((x) => x.crewId === myCrewId)?.score ?? 0) : 0,
    };
  });

  const board: TerritoryLeaderRow[] = [...tally.entries()]
    .filter(([id]) => crews.has(id))
    .map(([crewId, t]) => ({ crewId, name: crews.get(crewId)!.name, color: crews.get(crewId)!.color, owned: t.owned, score: t.score, rank: 0 }))
    .sort((a, b) => b.owned - a.owned || b.score - a.score || a.name.localeCompare(b.name));
  board.forEach((row, i) => (row.rank = i + 1));

  let myCrew: TerritoryLeaderRow | null = null;
  if (myCrewId) {
    myCrew = board.find((r) => r.crewId === myCrewId) ?? null;
    if (!myCrew) {
      const c = await db.query<{ name: string; color: string }>('SELECT name, color FROM crews WHERE id = $1', [myCrewId]);
      if (c.rows[0]) {
        myCrew = { crewId: myCrewId, name: c.rows[0].name, color: c.rows[0].color, owned: 0, score: 0, rank: board.length + 1 };
      }
    }
  }

  return { cityId, weekStart: ws, weekEnd: we, neighbourhoods, leaderboard: board.slice(0, 20), myCrew };
}
