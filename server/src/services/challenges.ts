import { getCity, type AdminChallengeBody, type ChallengeTeamRow, type ChallengeView } from '@unfog/core';
import type { Db, Queryable } from '../db';
import { withTx } from '../db';
import { badRequest, conflict, gone, isUniqueViolation, notFound } from '../errors';
import { randomCode } from '../util';

export async function adminCreateChallenge(db: Db, body: AdminChallengeBody) {
  if (!getCity(body.cityId)) throw badRequest('unknown_city');
  return withTx(db, async (tx) => {
    const c = await tx.query<{ id: string }>(
      'INSERT INTO challenges (name, city_id, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING id',
      [body.name, body.cityId, body.startsOn, body.endsOn],
    );
    const challengeId = c.rows[0]!.id;
    const teams: { id: string; name: string; color: string; joinCode: string }[] = [];
    for (const t of body.teams) {
      for (let attempt = 0; ; attempt++) {
        const code = randomCode(8);
        await tx.query('SAVEPOINT team_code');
        try {
          const r = await tx.query<{ id: string }>(
            'INSERT INTO challenge_teams (challenge_id, name, color, join_code) VALUES ($1, $2, $3, $4) RETURNING id',
            [challengeId, t.name, t.color, code],
          );
          teams.push({ id: r.rows[0]!.id, name: t.name, color: t.color, joinCode: code });
          break;
        } catch (err) {
          await tx.query('ROLLBACK TO SAVEPOINT team_code');
          if (!isUniqueViolation(err) || attempt >= 5) throw err;
        }
      }
    }
    return { id: challengeId, name: body.name, cityId: body.cityId, startsOn: body.startsOn, endsOn: body.endsOn, teams };
  });
}

export async function joinChallenge(db: Db, userId: string, code: string, today: string): Promise<string> {
  const t = await db.query<{ team_id: string; challenge_id: string; ends_on: string }>(
    `SELECT t.id AS team_id, c.id AS challenge_id, c.ends_on
     FROM challenge_teams t JOIN challenges c ON c.id = t.challenge_id WHERE t.join_code = $1`,
    [code],
  );
  const row = t.rows[0];
  if (!row) throw notFound('invalid_code', 'That challenge code does not exist.');
  if (row.ends_on < today) throw gone('challenge_ended', 'That challenge has ended.');
  const existing = await db.query<{ team_id: string }>(
    'SELECT team_id FROM challenge_members WHERE challenge_id = $1 AND user_id = $2',
    [row.challenge_id, userId],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].team_id === row.team_id) return row.challenge_id;
    throw conflict('already_joined', 'You are already on another team in this challenge.');
  }
  await db.query('INSERT INTO challenge_members (challenge_id, team_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
    row.challenge_id,
    row.team_id,
    userId,
  ]);
  return row.challenge_id;
}

export async function leaveChallenge(db: Db, userId: string, challengeId: string): Promise<void> {
  const r = await db.query('DELETE FROM challenge_members WHERE challenge_id = $1 AND user_id = $2', [challengeId, userId]);
  if (!r.rowCount) throw notFound('not_a_member');
}

/**
 * Team score is the sum of members' daily presence in the challenge city between the start
 * date and the earlier of the end date and today. Presence counts from the challenge start,
 * even for members who joined later.
 */
export async function teamScores(db: Queryable, challengeId: string, today: string): Promise<ChallengeTeamRow[]> {
  const { rows } = await db.query<{ id: string; name: string; color: string; members: number; score: number }>(
    `SELECT t.id, t.name, t.color,
            (SELECT count(*)::int FROM challenge_members m WHERE m.team_id = t.id) AS members,
            coalesce((
              SELECT sum(nd.cell_days)::int
              FROM challenge_members m JOIN neighbourhood_days nd ON nd.user_id = m.user_id
              WHERE m.team_id = t.id AND nd.city_id = c.city_id
                AND nd.day >= c.starts_on AND nd.day <= least(c.ends_on, $2::date)
            ), 0) AS score
     FROM challenge_teams t JOIN challenges c ON c.id = t.challenge_id
     WHERE t.challenge_id = $1
     ORDER BY score DESC, t.name`,
    [challengeId, today],
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function myChallenges(db: Db, userId: string, today: string): Promise<ChallengeView[]> {
  const mine = await db.query<{ id: string; name: string; city_id: string; starts_on: string; ends_on: string; team_id: string }>(
    `SELECT c.id, c.name, c.city_id, c.starts_on, c.ends_on, m.team_id
     FROM challenge_members m JOIN challenges c ON c.id = m.challenge_id
     WHERE m.user_id = $1 ORDER BY c.ends_on DESC`,
    [userId],
  );
  const out: ChallengeView[] = [];
  for (const c of mine.rows) {
    const top = await db.query<{ user_id: string; username: string | null; score: number }>(
      `SELECT m.user_id, u.username,
              coalesce((SELECT sum(nd.cell_days)::int FROM neighbourhood_days nd
                        WHERE nd.user_id = m.user_id AND nd.city_id = $2
                          AND nd.day >= $3 AND nd.day <= least($4::date, $5::date)), 0) AS score
       FROM challenge_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1 ORDER BY score DESC, u.username LIMIT 10`,
      [c.team_id, c.city_id, c.starts_on, c.ends_on, today],
    );
    out.push({
      id: c.id,
      name: c.name,
      cityId: c.city_id,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
      status: today < c.starts_on ? 'upcoming' : today > c.ends_on ? 'ended' : 'live',
      myTeamId: c.team_id,
      teams: await teamScores(db, c.id, today),
      myTeamTop: top.rows.map((r) => ({ userId: r.user_id, username: r.username, score: r.score })),
    });
  }
  return out;
}
