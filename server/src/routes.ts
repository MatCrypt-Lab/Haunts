import type { FastifyInstance } from 'fastify';
import {
  adminChallengeBody,
  adminDropBody,
  codeBody,
  crewCreateBody,
  crewPatchBody,
  dropCreateBody,
  forgetCellsBody,
  memoryBackupBody,
  getCity,
  monthKey,
  monthSchema,
  otpRequestBody,
  otpVerifyBody,
  profilePatchBody,
  visitsBody,
  type AuthResult,
} from '@unfog/core';
import { z } from 'zod';
import type { AppContext } from './app';
import { badRequest, conflict, isUniqueViolation, notFound, parse } from './errors';
import { deleteAccount, exportAccount } from './services/account';
import { createSession, deleteSession, findOrCreateUser, getMe, requestLoginCode, verifyLoginCode } from './services/auth';
import { adminCreateChallenge, joinChallenge, leaveChallenge, myChallenges, teamScores } from './services/challenges';
import { loadContext, todayFor } from './services/context';
import { createCrew, getCrewDetails, getCrewMap, joinCrew, kickMember, leaveCrew, patchCrew } from './services/crews';
import { adminCreateDrop, createCommunityDrop, deleteDrop, listDrops, reportDrop } from './services/drops';
import { getRecap, getStats, getTitles } from './services/stats';
import { getTerritory } from './services/territory';
import { forgetCells, ingestVisits } from './services/visits';

const idParam = z.object({ id: z.uuid() });

export async function registerRoutes(app: FastifyInstance, c: AppContext): Promise<void> {
  const { db } = c;

  // ---------- Auth ----------
  app.post('/auth/otp/request', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = parse(otpRequestBody, req.body);
    const r = await requestLoginCode(db, c.config, c.mailer, email);
    return { ok: true, ...r };
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req): Promise<AuthResult> => {
    const { email, code } = parse(otpVerifyBody, req.body);
    await verifyLoginCode(db, c.config, email, code);
    const { id } = await findOrCreateUser(db, email);
    const token = await createSession(db, id);
    const user = (await getMe(db, id))!;
    return { token, user, isNew: user.username === null };
  });

  app.post('/auth/logout', async (req) => {
    if (req.token) await deleteSession(db, req.token);
    return { ok: true };
  });

  // ---------- Me ----------
  app.get('/me', async (req) => {
    const userId = c.requireUser(req);
    const me = await getMe(db, userId);
    if (!me) throw notFound('user_not_found');
    return me;
  });

  app.patch('/me', async (req) => {
    const userId = c.requireUser(req);
    const body = parse(profilePatchBody, req.body);
    if (body.cityId !== undefined && !getCity(body.cityId)) throw badRequest('unknown_city', 'That city is not supported yet.');
    try {
      await db.query(
        `UPDATE users SET username = coalesce($2, username), display_name = coalesce($3, display_name),
                          city_id = coalesce($4, city_id) WHERE id = $1`,
        [userId, body.username ?? null, body.displayName ?? null, body.cityId ?? null],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('username_taken', 'That username is taken.');
      throw err;
    }
    return getMe(db, userId);
  });

  app.delete('/me', async (req) => {
    const userId = c.requireUser(req);
    await deleteAccount(db, userId);
    return { ok: true };
  });

  app.get('/me/export', async (req) => exportAccount(db, c.requireUser(req)));

  app.get('/me/cells', async (req) => {
    const userId = c.requireUser(req);
    const { rows } = await db.query<{ cell: string; first_day: string }>(
      'SELECT cell, first_day FROM user_cells WHERE user_id = $1',
      [userId],
    );
    return { cells: rows.map((r) => [r.cell, r.first_day]) };
  });

  app.post('/me/cells/forget', async (req) => {
    const userId = c.requireUser(req);
    return forgetCells(db, userId, parse(forgetCellsBody, req.body).cells);
  });

  // ---------- Encrypted memory backup ----------
  app.put('/me/memory-backup', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const userId = c.requireUser(req);
    const { data } = parse(memoryBackupBody, req.body);
    const blob = Buffer.from(data, 'base64');
    const { rows } = await db.query<{ updated_at: Date }>(
      `INSERT INTO memory_backups (user_id, blob, size_bytes) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET blob = EXCLUDED.blob, size_bytes = EXCLUDED.size_bytes, updated_at = now()
       RETURNING updated_at`,
      [userId, blob, blob.length],
    );
    return { sizeBytes: blob.length, updatedAt: rows[0]!.updated_at.toISOString() };
  });

  app.get('/me/memory-backup', async (req) => {
    const userId = c.requireUser(req);
    const meta = parse(z.object({ meta: z.enum(['1']).optional() }), req.query).meta === '1';
    const { rows } = await db.query<{ blob: Buffer | null; size_bytes: number; updated_at: Date }>(
      `SELECT ${meta ? 'NULL::bytea AS blob' : 'blob'}, size_bytes, updated_at FROM memory_backups WHERE user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) throw notFound('no_backup', 'No memory backup yet.');
    const info = { sizeBytes: r.size_bytes, updatedAt: r.updated_at.toISOString() };
    return meta ? info : { ...info, data: r.blob!.toString('base64') };
  });

  app.delete('/me/memory-backup', async (req) => {
    await db.query('DELETE FROM memory_backups WHERE user_id = $1', [c.requireUser(req)]);
    return { ok: true };
  });

  app.get('/me/stats', async (req) => getStats(db, await loadContext(db, c.requireUser(req), c.now())));
  app.get('/me/titles', async (req) => ({ titles: await getTitles(db, await loadContext(db, c.requireUser(req), c.now())) }));

  app.get('/me/recap', async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    const q = parse(z.object({ month: monthSchema.optional() }), req.query);
    return getRecap(db, ctx, q.month ?? monthKey(ctx.today));
  });

  // ---------- Visits ----------
  app.post('/visits', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    const { visits } = parse(visitsBody, req.body);
    return ingestVisits(db, ctx.userId, visits, ctx.today);
  });

  // ---------- Crews ----------
  app.post('/crews', async (req) => {
    const userId = c.requireUser(req);
    const crewId = await createCrew(db, userId, parse(crewCreateBody, req.body));
    const ctx = await loadContext(db, userId, c.now());
    return getCrewDetails(db, userId, crewId, ctx.today);
  });

  app.post('/crews/join', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const userId = c.requireUser(req);
    const crewId = await joinCrew(db, userId, parse(codeBody, req.body).code);
    const ctx = await loadContext(db, userId, c.now());
    return getCrewDetails(db, userId, crewId, ctx.today);
  });

  app.post('/crews/leave', async (req) => {
    await leaveCrew(db, c.requireUser(req));
    return { ok: true };
  });

  app.get('/crews/mine', async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    if (!ctx.crewId) return { crew: null };
    return { crew: await getCrewDetails(db, ctx.userId, ctx.crewId, ctx.today) };
  });

  app.patch('/crews/mine', async (req) => {
    const userId = c.requireUser(req);
    await patchCrew(db, userId, parse(crewPatchBody, req.body));
    const ctx = await loadContext(db, userId, c.now());
    return getCrewDetails(db, userId, ctx.crewId!, ctx.today);
  });

  app.delete('/crews/mine/members/:id', async (req) => {
    const userId = c.requireUser(req);
    await kickMember(db, userId, parse(idParam, req.params).id);
    return { ok: true };
  });

  app.get('/crews/mine/map', async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    if (!ctx.crewId) throw notFound('no_crew', 'You are not in a crew.');
    return { cells: await getCrewMap(db, ctx.crewId, ctx.today) };
  });

  // ---------- Territory ----------
  app.get('/territory', async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    return getTerritory(db, ctx.cityId, ctx.today, ctx.crewId);
  });

  // ---------- Drops ----------
  app.get('/drops', async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    return listDrops(db, ctx.userId, ctx.cityId);
  });

  app.post('/drops', async (req) => createCommunityDrop(db, c.requireUser(req), parse(dropCreateBody, req.body)));

  app.post('/drops/:id/report', async (req) => reportDrop(db, c.requireUser(req), parse(idParam, req.params).id));

  app.delete('/drops/:id', async (req) => {
    await deleteDrop(db, c.requireUser(req), parse(idParam, req.params).id);
    return { ok: true };
  });

  // ---------- Challenges ----------
  app.post('/challenges/join', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    await joinChallenge(db, ctx.userId, parse(codeBody, req.body).code, ctx.today);
    return { challenges: await myChallenges(db, ctx.userId, ctx.today) };
  });

  app.get('/challenges/mine', async (req) => {
    const ctx = await loadContext(db, c.requireUser(req), c.now());
    return { challenges: await myChallenges(db, ctx.userId, ctx.today) };
  });

  app.post('/challenges/:id/leave', async (req) => {
    await leaveChallenge(db, c.requireUser(req), parse(idParam, req.params).id);
    return { ok: true };
  });

  // ---------- Admin (x-admin-key) ----------
  app.post('/admin/drops', async (req) => {
    c.requireAdmin(req);
    return adminCreateDrop(db, parse(adminDropBody, req.body));
  });

  app.post('/admin/challenges', async (req) => {
    c.requireAdmin(req);
    return adminCreateChallenge(db, parse(adminChallengeBody, req.body));
  });

  app.get('/admin/challenges/:id', async (req) => {
    c.requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const ch = await db.query<{ id: string; name: string; city_id: string; starts_on: string; ends_on: string }>(
      'SELECT id, name, city_id, starts_on, ends_on FROM challenges WHERE id = $1',
      [id],
    );
    const row = ch.rows[0];
    if (!row) throw notFound('challenge_not_found');
    const codes = await db.query<{ id: string; join_code: string }>('SELECT id, join_code FROM challenge_teams WHERE challenge_id = $1', [id]);
    const codeById = new Map(codes.rows.map((r) => [r.id, r.join_code]));
    const teams = await teamScores(db, id, todayFor(row.city_id, c.now()).today);
    return { ...row, teams: teams.map((t) => ({ ...t, joinCode: codeById.get(t.id) })) };
  });

  app.get('/admin/stats', async (req) => {
    c.requireAdmin(req);
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM users WHERE username IS NOT NULL) AS onboarded,
              (SELECT count(DISTINCT user_id)::int FROM user_days WHERE day >= current_date - 1) AS active_1d,
              (SELECT count(DISTINCT user_id)::int FROM user_days WHERE day >= current_date - 7) AS active_7d,
              (SELECT count(DISTINCT user_id)::int FROM user_days WHERE day >= current_date - 30) AS active_30d,
              (SELECT count(*)::int FROM crews) AS crews,
              (SELECT count(*)::int FROM drops WHERE NOT hidden) AS drops,
              (SELECT count(*)::int FROM drop_finds) AS drop_finds`,
    );
    return rows[0];
  });
}
