import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, newUser, resetData, signIn, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => (h = await createHarness()));
afterAll(async () => {
  await h.app.close();
  await h.db.end();
});
beforeEach(() => resetData(h.db));

describe('auth', () => {
  it('signs up with an email code, then completes the profile', async () => {
    const auth = await signIn(h.app, 'Priya@Example.com');
    expect(auth.isNew).toBe(true);
    expect(auth.user.email).toBe('priya@example.com');
    expect(auth.token.length).toBeGreaterThan(30);

    const me = await h.app.inject({ method: 'GET', url: '/me', headers: bearer(auth.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBeNull();

    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(auth.token),
      payload: { username: 'Priya.K', displayName: 'Priya' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ username: 'priya.k', displayName: 'Priya', cityId: 'blr' });

    const again = await signIn(h.app, 'priya@example.com');
    expect(again.isNew).toBe(false);
    expect(again.user.id).toBe(auth.user.id);
  });

  it('rejects requests without a valid token', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: bearer('nope') })).statusCode).toBe(401);
  });

  it('rejects wrong codes and locks after too many attempts', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { email: 'a@example.com' } });
    const code = r.json().devCode as string;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const v = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { email: 'a@example.com', code: wrong } });
      expect(v.statusCode).toBe(400);
      expect(v.json().error).toBe('invalid_code');
    }
    const locked = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { email: 'a@example.com', code } });
    expect(locked.statusCode).toBe(429);
  });

  it('expires codes', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { email: 'b@example.com' } });
    await h.db.query(`UPDATE otp_codes SET expires_at = now() - interval '1 minute'`);
    const v = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { email: 'b@example.com', code: r.json().devCode } });
    expect(v.json().error).toBe('code_expired');
  });

  it('accepts the fixed reviewer login without sending email', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { email: 'review@unfog.app' } });
    expect(r.json().devCode).toBeUndefined();
    const v = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { email: 'review@unfog.app', code: '424242' } });
    expect(v.statusCode).toBe(200);
    const bad = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { email: 'review@unfog.app', code: '424243' } });
    expect(bad.statusCode).toBe(400);
  });

  it('enforces unique usernames and validates input', async () => {
    await newUser(h.app, 'taken');
    const other = await signIn(h.app, 'other@example.com');
    const dup = await h.app.inject({ method: 'PATCH', url: '/me', headers: bearer(other.token), payload: { username: 'TAKEN' } });
    expect(dup.statusCode).toBe(409);
    const bad = await h.app.inject({ method: 'PATCH', url: '/me', headers: bearer(other.token), payload: { username: 'a b' } });
    expect(bad.statusCode).toBe(400);
    const city = await h.app.inject({ method: 'PATCH', url: '/me', headers: bearer(other.token), payload: { cityId: 'atlantis' } });
    expect(city.json().error).toBe('unknown_city');
  });

  it('stores, returns and deletes an encrypted memory backup', async () => {
    const { token } = await newUser(h.app, 'backer');
    const missing = await h.app.inject({ method: 'GET', url: '/me/memory-backup', headers: bearer(token) });
    expect(missing.statusCode).toBe(404);

    const data = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256)).toString('base64');
    const put = await h.app.inject({ method: 'PUT', url: '/me/memory-backup', headers: bearer(token), payload: { data } });
    expect(put.statusCode).toBe(200);
    expect(put.json().sizeBytes).toBe(300);

    const meta = (await h.app.inject({ method: 'GET', url: '/me/memory-backup?meta=1', headers: bearer(token) })).json();
    expect(meta).toEqual({ sizeBytes: 300, updatedAt: put.json().updatedAt });
    const full = (await h.app.inject({ method: 'GET', url: '/me/memory-backup', headers: bearer(token) })).json();
    expect(full.data).toBe(data);

    const bad = await h.app.inject({ method: 'PUT', url: '/me/memory-backup', headers: bearer(token), payload: { data: 'not base64!!'.repeat(5) } });
    expect(bad.statusCode).toBe(400);

    // A large but allowed backup (about 6 MB) goes through.
    const big = Buffer.alloc(6 * 1024 * 1024, 7).toString('base64');
    const bigPut = await h.app.inject({ method: 'PUT', url: '/me/memory-backup', headers: bearer(token), payload: { data: big } });
    expect(bigPut.statusCode).toBe(200);

    await h.app.inject({ method: 'DELETE', url: '/me/memory-backup', headers: bearer(token) });
    expect((await h.app.inject({ method: 'GET', url: '/me/memory-backup', headers: bearer(token) })).statusCode).toBe(404);
  });

  it('deletes the memory backup with the account', async () => {
    const { token, id } = await newUser(h.app, 'backdel');
    await h.app.inject({ method: 'PUT', url: '/me/memory-backup', headers: bearer(token), payload: { data: Buffer.alloc(64, 1).toString('base64') } });
    await h.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect((await h.db.query('SELECT count(*)::int AS n FROM memory_backups WHERE user_id = $1', [id])).rows[0].n).toBe(0);
  });

  it('logs out by revoking the session', async () => {
    const { token } = await newUser(h.app, 'leaver');
    await h.app.inject({ method: 'POST', url: '/auth/logout', headers: bearer(token) });
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).statusCode).toBe(401);
  });

  it('deletes the account and all its data', async () => {
    const { token, id } = await newUser(h.app, 'gone');
    await h.app.inject({ method: 'POST', url: '/crews', headers: bearer(token), payload: { name: 'Solo', color: '#FF5A5F' } });
    const del = await h.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect(del.statusCode).toBe(200);
    const { rows } = await h.db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [id]);
    expect(rows[0].n).toBe(0);
    expect((await h.db.query('SELECT count(*)::int AS n FROM crews')).rows[0].n).toBe(0);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).statusCode).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits anonymous sign-in requests per IP and signed-in traffic per account', async () => {
    const limited = await createHarness({ rateLimit: true });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 21; i++) {
        const r = await limited.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { email: `rl${i}@example.com` } });
        codes.push(r.statusCode);
      }
      expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
      expect(codes[20]).toBe(429);
      // Fake bearer tokens do not escape the per-IP limit.
      const fake = await limited.app.inject({
        method: 'POST',
        url: '/auth/otp/request',
        headers: { authorization: 'Bearer random-token-123' },
        payload: { email: 'x@example.com' },
      });
      expect(fake.statusCode).toBe(429);
    } finally {
      await limited.app.close();
      await limited.db.end();
    }
  });

  it('limits codes sent to one email per hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { email: 'spam@example.com' } })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
