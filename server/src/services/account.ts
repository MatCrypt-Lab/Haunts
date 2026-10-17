import type { Db } from '../db';
import { withTx } from '../db';
import { removeFromCrew } from './crews';

/** Permanently deletes the account and everything tied to it. Required by both app stores. */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  await withTx(db, async (tx) => {
    await removeFromCrew(tx, userId);
    // Ownership of any other crews (should not exist, but be safe) is transferred or the crew removed.
    const owned = await tx.query<{ id: string }>('SELECT id FROM crews WHERE owner_id = $1', [userId]);
    for (const c of owned.rows) {
      const next = await tx.query<{ id: string }>(
        'SELECT id FROM users WHERE crew_id = $1 AND id <> $2 ORDER BY crew_joined_at, id LIMIT 1',
        [c.id, userId],
      );
      if (next.rows[0]) await tx.query('UPDATE crews SET owner_id = $2 WHERE id = $1', [c.id, next.rows[0].id]);
      else await tx.query('DELETE FROM crews WHERE id = $1', [c.id]);
    }
    await tx.query(`DELETE FROM drops WHERE created_by = $1 AND kind = 'community'`, [userId]);
    await tx.query('DELETE FROM users WHERE id = $1', [userId]);
  });
}

/** Everything stored about a user, for data access requests. */
export async function exportAccount(db: Db, userId: string) {
  const q = async (sql: string) => (await db.query(sql, [userId])).rows;
  return {
    exportedAt: new Date().toISOString(),
    user: (await q('SELECT id, email, username, display_name, city_id, crew_id, created_at FROM users WHERE id = $1'))[0],
    cells: await q('SELECT cell, city_id, neighbourhood_id, first_day, last_day, visit_days FROM user_cells WHERE user_id = $1 ORDER BY first_day'),
    days: await q('SELECT day, cell_days, new_cells FROM user_days WHERE user_id = $1 ORDER BY day'),
    neighbourhoodDays: await q('SELECT city_id, neighbourhood_id, day, cell_days FROM neighbourhood_days WHERE user_id = $1 ORDER BY day'),
    pioneer: await q('SELECT city_id, neighbourhood_id, achieved_at FROM neighbourhood_pioneers WHERE user_id = $1'),
    dropsCreated: await q('SELECT id, cell, title, note, created_at FROM drops WHERE created_by = $1'),
    dropsFound: await q('SELECT drop_id, found_at FROM drop_finds WHERE user_id = $1'),
    challenges: await q('SELECT challenge_id, team_id, joined_at FROM challenge_members WHERE user_id = $1'),
  };
}
