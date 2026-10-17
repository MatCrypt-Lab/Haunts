import type { FastifyInstance } from 'fastify';
import { cellDisk, latLngToCell, type AuthResult } from '@unfog/core';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool, type Db } from '../src/db';
import { migrate } from '../src/migrate';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/unfog_test';
export const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

export const clock = {
  value: new Date('2026-10-14T06:00:00Z'), // Wednesday, 11:30 IST
  set(iso: string) {
    this.value = new Date(iso);
  },
};

export type Harness = { app: FastifyInstance; db: Db };

export async function createHarness(opts: { rateLimit?: boolean } = {}): Promise<Harness> {
  const db = createPool(TEST_DATABASE_URL, false);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    DEV_RETURN_OTP: 'true',
    ADMIN_API_KEY: ADMIN_KEY,
    REVIEW_LOGIN_EMAIL: 'review@unfog.app',
    REVIEW_LOGIN_CODE: '424242',
    RATE_LIMIT: opts.rateLimit ? 'true' : 'false',
  });
  const sent: { email: string; code: string }[] = [];
  const app = await buildApp({
    config,
    db,
    now: () => clock.value,
    mailer: { sendLoginCode: async (email, code) => void sent.push({ email, code }) },
  });
  await app.ready();
  return { app, db };
}

export async function resetData(db: Db): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  await db.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  clock.set('2026-10-14T06:00:00Z');
}

export function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

export async function signIn(app: FastifyInstance, email: string): Promise<AuthResult> {
  const r1 = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { email } });
  if (r1.statusCode !== 200) throw new Error(`otp request failed: ${r1.body}`);
  const code = r1.json().devCode as string;
  const r2 = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { email, code } });
  if (r2.statusCode !== 200) throw new Error(`otp verify failed: ${r2.body}`);
  return r2.json() as AuthResult;
}

/** Signs in and completes the profile. */
export async function newUser(app: FastifyInstance, username: string): Promise<{ token: string; id: string }> {
  const auth = await signIn(app, `${username}@example.com`);
  const r = await app.inject({ method: 'PATCH', url: '/me', headers: bearer(auth.token), payload: { username } });
  if (r.statusCode !== 200) throw new Error(`profile failed: ${r.body}`);
  return { token: auth.token, id: auth.user.id };
}

export async function postVisits(app: FastifyInstance, token: string, visits: { cell: string; day: string }[]) {
  return app.inject({ method: 'POST', url: '/visits', headers: bearer(token), payload: { visits } });
}

export const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
export const INDIRANAGAR = { lat: 12.9719, lng: 77.6412 };

/** n distinct cells around a point, nearest first. */
export function cellsNear(p: { lat: number; lng: number }, n: number): string[] {
  let k = 0;
  let disk = cellDisk(latLngToCell(p), k);
  while (disk.length < n) disk = cellDisk(latLngToCell(p), ++k);
  return disk.slice(0, n);
}
