import { LIMITS, weekStart, type CrewCreateBody, type CrewDetails, type CrewMapCell, type CrewPatchBody } from '@unfog/core';
import type pg from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { conflict, forbidden, isUniqueViolation, notFound } from '../errors';
import { randomCode } from '../util';

async function lockUser(tx: pg.PoolClient, userId: string): Promise<{ crew_id: string | null }> {
  const { rows } = await tx.query<{ crew_id: string | null }>('SELECT crew_id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!rows[0]) throw notFound('user_not_found');
  return rows[0];
}

async function insertWithUniqueCode<T>(attempt: (code: string) => Promise<T>, length = 6): Promise<T> {
  for (let i = 0; i < 6; i++) {
    try {
      return await attempt(randomCode(length));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('Could not generate a unique code');
}

export async function createCrew(db: Db, userId: string, body: CrewCreateBody): Promise<string> {
  return withTx(db, async (tx) => {
    const u = await lockUser(tx, userId);
    if (u.crew_id) throw conflict('already_in_crew', 'Leave your current crew first.');
    await tx.query('SAVEPOINT crew_code');
    const crewId = await insertWithUniqueCode(async (code) => {
      try {
        const r = await tx.query<{ id: string }>(
          'INSERT INTO crews (name, color, invite_code, owner_id) VALUES ($1, $2, $3, $4) RETURNING id',
          [body.name, body.color, code, userId],
        );
        return r.rows[0]!.id;
      } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT crew_code');
        throw err;
      }
    });
    await tx.query('UPDATE users SET crew_id = $2, crew_joined_at = now() WHERE id = $1', [userId, crewId]);
    return crewId;
  });
}

export async function joinCrew(db: Db, userId: string, code: string): Promise<string> {
  return withTx(db, async (tx) => {
    const u = await lockUser(tx, userId);
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM crews WHERE invite_code = $1 FOR UPDATE', [code]);
    const crew = rows[0];
    if (!crew) throw notFound('invalid_invite', 'That invite code does not exist.');
    if (u.crew_id === crew.id) return crew.id;
    if (u.crew_id) throw conflict('already_in_crew', 'Leave your current crew first.');
    const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE crew_id = $1', [crew.id]);
    if (count.rows[0]!.n >= LIMITS.crewMaxMembers) throw conflict('crew_full', `Crews are capped at ${LIMITS.crewMaxMembers}.`);
    await tx.query('UPDATE users SET crew_id = $2, crew_joined_at = now() WHERE id = $1', [userId, crew.id]);
    return crew.id;
  });
}

/** Removes a user from their crew, handing ownership to the longest-standing member or deleting an empty crew. */
export async function removeFromCrew(tx: pg.PoolClient, userId: string): Promise<void> {
  const u = await lockUser(tx, userId);
  if (!u.crew_id) return;
  const crewId = u.crew_id;
  const { rows } = await tx.query<{ owner_id: string }>('SELECT owner_id FROM crews WHERE id = $1 FOR UPDATE', [crewId]);
  await tx.query('UPDATE users SET crew_id = NULL, crew_joined_at = NULL WHERE id = $1', [userId]);
  if (rows[0]?.owner_id !== userId) return;
  const next = await tx.query<{ id: string }>(
    'SELECT id FROM users WHERE crew_id = $1 ORDER BY crew_joined_at, id LIMIT 1',
    [crewId],
  );
  if (next.rows[0]) await tx.query('UPDATE crews SET owner_id = $2 WHERE id = $1', [crewId, next.rows[0].id]);
  else await tx.query('DELETE FROM crews WHERE id = $1', [crewId]);
}

export async function leaveCrew(db: Db, userId: string): Promise<void> {
  await withTx(db, (tx) => removeFromCrew(tx, userId));
}

async function requireOwner(db: Db | pg.PoolClient, userId: string): Promise<string> {
  const { rows } = await db.query<{ crew_id: string | null; owner_id: string | null }>(
    'SELECT u.crew_id, c.owner_id FROM users u LEFT JOIN crews c ON c.id = u.crew_id WHERE u.id = $1',
    [userId],
  );
  const r = rows[0];
  if (!r?.crew_id) throw notFound('no_crew', 'You are not in a crew.');
  if (r.owner_id !== userId) throw forbidden('not_crew_owner', 'Only the crew owner can do that.');
  return r.crew_id;
}

export async function patchCrew(db: Db, userId: string, body: CrewPatchBody): Promise<void> {
  const crewId = await requireOwner(db, userId);
  if (body.name !== undefined || body.color !== undefined) {
    await db.query('UPDATE crews SET name = coalesce($2, name), color = coalesce($3, color) WHERE id = $1', [
      crewId,
      body.name ?? null,
      body.color ?? null,
    ]);
  }
  if (body.rotateInviteCode) {
    await insertWithUniqueCode((code) => db.query('UPDATE crews SET invite_code = $2 WHERE id = $1', [crewId, code]));
  }
}

export async function kickMember(db: Db, ownerId: string, memberId: string): Promise<void> {
  const crewId = await requireOwner(db, ownerId);
  if (memberId === ownerId) throw conflict('cannot_kick_self', 'Leave the crew instead.');
  const r = await db.query('UPDATE users SET crew_id = NULL, crew_joined_at = NULL WHERE id = $1 AND crew_id = $2', [memberId, crewId]);
  if (!r.rowCount) throw notFound('member_not_found');
}

export async function getCrewDetails(db: Db, userId: string, crewId: string, today: string): Promise<CrewDetails> {
  const crew = await db.query<{ id: string; name: string; color: string; invite_code: string; owner_id: string }>(
    'SELECT id, name, color, invite_code, owner_id FROM crews WHERE id = $1',
    [crewId],
  );
  const c = crew.rows[0];
  if (!c) throw notFound('no_crew');
  const members = await db.query<{ id: string; username: string | null; display_name: string | null; total_cells: number; week: number }>(
    `SELECT u.id, u.username, u.display_name,
            (SELECT count(*)::int FROM user_cells uc WHERE uc.user_id = u.id) AS total_cells,
            (SELECT coalesce(sum(ud.cell_days), 0)::int FROM user_days ud WHERE ud.user_id = u.id AND ud.day >= $2) AS week
     FROM users u WHERE u.crew_id = $1
     ORDER BY week DESC, total_cells DESC, u.crew_joined_at`,
    [crewId, weekStart(today)],
  );
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    inviteCode: c.invite_code,
    isOwner: c.owner_id === userId,
    maxMembers: LIMITS.crewMaxMembers,
    members: members.rows.map((m) => ({
      id: m.id,
      username: m.username,
      displayName: m.display_name,
      isOwner: m.id === c.owner_id,
      totalCells: m.total_cells,
      weekCellDays: m.week,
    })),
  };
}

/**
 * The crew's combined map. Cells first seen today are withheld, so the map never shows
 * where anyone is right now. No days or times are returned.
 */
export async function getCrewMap(db: Db, crewId: string, today: string, limit = 60_000): Promise<CrewMapCell[]> {
  const { rows } = await db.query<{ cell: string; members: number }>(
    `SELECT uc.cell, count(*)::int AS members
     FROM user_cells uc JOIN users u ON u.id = uc.user_id
     WHERE u.crew_id = $1 AND uc.first_day < $2
     GROUP BY uc.cell
     ORDER BY members DESC, uc.cell
     LIMIT $3`,
    [crewId, today, limit],
  );
  return rows;
}
