import { randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS, type Me } from '@unfog/core';
import type { Config } from '../config';
import type { Db, Queryable } from '../db';
import { badRequest, tooMany } from '../errors';
import { iso, randomToken, sha256 } from '../util';
import type { Mailer } from './mailer';

function hashCode(config: Config, email: string, code: string): Buffer {
  return sha256(`${config.otpPepper}:${email}:${code}`);
}

export async function requestLoginCode(
  db: Db,
  config: Config,
  mailer: Mailer,
  email: string,
): Promise<{ devCode?: string }> {
  if (config.reviewEmail && email === config.reviewEmail) return {};

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + LIMITS.otpTtlMinutes * 60_000);

  // Upsert with a rolling one-hour send window per email.
  const { rows } = await db.query<{ sends_in_window: number }>(
    `INSERT INTO otp_codes (email, code_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       attempts = 0,
       sends_in_window = CASE WHEN otp_codes.window_started_at < now() - interval '1 hour'
                              THEN 1 ELSE otp_codes.sends_in_window + 1 END,
       window_started_at = CASE WHEN otp_codes.window_started_at < now() - interval '1 hour'
                                THEN now() ELSE otp_codes.window_started_at END
     RETURNING sends_in_window`,
    [email, hashCode(config, email, code), expiresAt],
  );
  if ((rows[0]?.sends_in_window ?? 0) > LIMITS.otpMaxSendsPerHour) {
    throw tooMany('too_many_codes', 'Too many codes requested. Try again in an hour.');
  }

  await mailer.sendLoginCode(email, code);
  return config.devReturnOtp ? { devCode: code } : {};
}

export async function verifyLoginCode(db: Db, config: Config, email: string, code: string): Promise<void> {
  if (config.reviewEmail && config.reviewCode && email === config.reviewEmail) {
    const a = Buffer.from(code);
    const b = Buffer.from(config.reviewCode);
    if (a.length === b.length && timingSafeEqual(a, b)) return;
    throw badRequest('invalid_code', 'That code is not right.');
  }

  const { rows } = await db.query<{ code_hash: Buffer; expires_at: Date; attempts: number }>(
    `UPDATE otp_codes SET attempts = attempts + 1 WHERE email = $1
     RETURNING code_hash, expires_at, attempts`,
    [email],
  );
  const row = rows[0];
  if (!row) throw badRequest('invalid_code', 'Request a new code.');
  if (row.attempts > LIMITS.otpMaxAttempts) throw tooMany('too_many_attempts', 'Too many attempts. Request a new code.');
  if (row.expires_at.getTime() < Date.now()) throw badRequest('code_expired', 'That code expired. Request a new one.');
  const expected = hashCode(config, email, code);
  if (!timingSafeEqual(row.code_hash, expected)) throw badRequest('invalid_code', 'That code is not right.');
  await db.query('DELETE FROM otp_codes WHERE email = $1', [email]);
}

export async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + LIMITS.sessionTtlDays * 86_400_000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    userId,
    expiresAt,
  ]);
  return token;
}

export async function userIdForToken(db: Db, token: string): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string; last_used_at: Date }>(
    'SELECT user_id, last_used_at FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  // Sliding expiry, written at most once an hour to avoid a write per request.
  if (Date.now() - row.last_used_at.getTime() > 3_600_000) {
    await db.query(
      `UPDATE sessions SET last_used_at = now(), expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`,
      [sha256(token), LIMITS.sessionTtlDays],
    );
  }
  return row.user_id;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function findOrCreateUser(db: Db, email: string): Promise<{ id: string; isNew: boolean }> {
  const { rows } = await db.query<{ id: string; inserted: boolean }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, (xmax = 0) AS inserted`,
    [email],
  );
  return { id: rows[0]!.id, isNew: rows[0]!.inserted };
}

type UserRow = {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  city_id: string;
  created_at: Date;
  crew_id: string | null;
  crew_name: string | null;
  crew_color: string | null;
  crew_owner_id: string | null;
};

export async function getMe(db: Queryable, userId: string): Promise<Me | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.id, u.email, u.username, u.display_name, u.city_id, u.created_at,
            c.id AS crew_id, c.name AS crew_name, c.color AS crew_color, c.owner_id AS crew_owner_id
     FROM users u LEFT JOIN crews c ON c.id = u.crew_id
     WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    displayName: r.display_name,
    cityId: r.city_id,
    createdAt: iso(r.created_at),
    crew: r.crew_id
      ? { id: r.crew_id, name: r.crew_name!, color: r.crew_color!, isOwner: r.crew_owner_id === r.id }
      : null,
  };
}
