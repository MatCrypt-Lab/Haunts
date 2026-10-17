import {
  LIMITS,
  getCity,
  getNeighbourhood,
  latLngToCell,
  placeForCell,
  type AdminDropBody,
  type DropCreateBody,
  type DropDetails,
  type DropsList,
} from '@unfog/core';
import type { Db } from '../db';
import { withTx } from '../db';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../errors';
import { DROP_ACTIVE_SQL, DROP_COLUMNS, neighbourhoodName, toDropDetails, type DropRow } from './drops-map';

export async function listDrops(db: Db, userId: string, cityId: string): Promise<DropsList> {
  const found = await db.query<DropRow>(
    `SELECT ${DROP_COLUMNS} FROM drops d JOIN drop_finds f ON f.drop_id = d.id AND f.user_id = $1
     WHERE NOT d.hidden ORDER BY f.found_at DESC LIMIT 500`,
    [userId],
  );
  const hidden = await db.query<DropRow>(
    `SELECT ${DROP_COLUMNS} FROM drops d
     WHERE d.city_id = $2 AND ${DROP_ACTIVE_SQL}
       AND NOT EXISTS (SELECT 1 FROM drop_finds f WHERE f.drop_id = d.id AND f.user_id = $1)
     ORDER BY d.created_at DESC LIMIT 500`,
    [userId, cityId],
  );
  return {
    found: found.rows.map((r) => toDropDetails(r, userId)),
    hidden: hidden.rows.map((r) => {
      const city = r.city_id ? getCity(r.city_id) : undefined;
      const nb = city && r.neighbourhood_id ? getNeighbourhood(city, r.neighbourhood_id) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        sponsor: r.sponsor,
        neighbourhoodId: r.neighbourhood_id,
        neighbourhoodName: neighbourhoodName(r.city_id, r.neighbourhood_id),
        hintLat: nb?.lat ?? null,
        hintLng: nb?.lng ?? null,
      };
    }),
  };
}

export async function createCommunityDrop(db: Db, userId: string, body: DropCreateBody): Promise<DropDetails> {
  const place = placeForCell(body.cell);
  if (!place) throw badRequest('outside_city', 'Drops can only be placed inside a supported city.');
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`drops:${userId}`]);
    const visited = await tx.query('SELECT 1 FROM user_cells WHERE user_id = $1 AND cell = $2', [userId, body.cell]);
    if (!visited.rowCount) throw forbidden('cell_not_explored', 'You can only leave a drop somewhere you have been.');
    const recent = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM drops WHERE created_by = $1 AND kind = 'community' AND created_at > now() - interval '7 days'`,
      [userId],
    );
    if (recent.rows[0]!.n >= LIMITS.communityDropsPerWeek) {
      throw tooMany('drop_limit', `You can leave ${LIMITS.communityDropsPerWeek} drops a week.`);
    }
    const ins = await tx.query<DropRow>(
      `INSERT INTO drops (cell, city_id, neighbourhood_id, title, note, kind, created_by)
       VALUES ($1, $2, $3, $4, $5, 'community', $6)
       RETURNING id, kind, title, note, sponsor, cell, city_id, neighbourhood_id, created_by`,
      [body.cell, place.cityId, place.neighbourhoodId, body.title, body.note ?? null, userId],
    );
    await tx.query('INSERT INTO drop_finds (drop_id, user_id) VALUES ($1, $2)', [ins.rows[0]!.id, userId]);
    return toDropDetails(ins.rows[0]!, userId);
  });
}

export async function reportDrop(db: Db, userId: string, dropId: string): Promise<{ hidden: boolean }> {
  return withTx(db, async (tx) => {
    const d = await tx.query<{ created_by: string | null }>('SELECT created_by FROM drops WHERE id = $1 FOR UPDATE', [dropId]);
    if (!d.rows[0]) throw notFound('drop_not_found');
    if (d.rows[0].created_by === userId) throw conflict('own_drop', 'Delete your own drop instead.');
    const ins = await tx.query('INSERT INTO drop_reports (drop_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [dropId, userId]);
    const r = await tx.query<{ hidden: boolean }>(
      `UPDATE drops SET report_count = report_count + $2, hidden = hidden OR report_count + $2 >= $3
       WHERE id = $1 RETURNING hidden`,
      [dropId, ins.rowCount ? 1 : 0, LIMITS.dropReportsToHide],
    );
    return { hidden: r.rows[0]!.hidden };
  });
}

export async function deleteDrop(db: Db, userId: string, dropId: string): Promise<void> {
  const r = await db.query('DELETE FROM drops WHERE id = $1 AND created_by = $2', [dropId, userId]);
  if (!r.rowCount) throw notFound('drop_not_found', 'Drop not found or not yours.');
}

export async function adminCreateDrop(db: Db, body: AdminDropBody): Promise<{ id: string; cell: string; cityId: string | null; neighbourhoodId: string | null }> {
  const cell = latLngToCell({ lat: body.lat, lng: body.lng });
  const place = placeForCell(cell);
  const r = await db.query<{ id: string }>(
    `INSERT INTO drops (cell, city_id, neighbourhood_id, title, note, kind, sponsor, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9::timestamptz) RETURNING id`,
    [cell, place?.cityId ?? null, place?.neighbourhoodId ?? null, body.title, body.note ?? null, body.kind, body.sponsor, body.startsAt ?? null, body.endsAt ?? null],
  );
  return { id: r.rows[0]!.id, cell, cityId: place?.cityId ?? null, neighbourhoodId: place?.neighbourhoodId ?? null };
}
