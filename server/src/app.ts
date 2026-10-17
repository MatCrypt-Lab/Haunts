import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config';
import type { Db } from './db';
import { HttpError, forbidden, unauthorized } from './errors';
import { userIdForToken } from './services/auth';
import { createMailer, type Mailer } from './services/mailer';
import { registerRoutes } from './routes';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    token: string | null;
  }
}

export type AppDeps = {
  config: Config;
  db: Db;
  mailer?: Mailer;
  /** Injectable clock for tests. */
  now?: () => Date;
};

export type AppContext = {
  config: Config;
  db: Db;
  mailer: Mailer;
  now: () => Date;
  requireUser: (req: FastifyRequest) => string;
  requireAdmin: (req: FastifyRequest) => void;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576,
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
            // Never log request bodies: they contain locations and codes.
            redact: ['req.headers.authorization', 'req.headers["x-admin-key"]'],
            transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
          },
  });

  await app.register(cors, { origin: false });
  app.decorateRequest('userId', null);
  app.decorateRequest('token', null);
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return;
    const token = h.slice(7).trim();
    if (!token || token.length > 128) return;
    req.token = token;
    req.userId = await userIdForToken(db, token);
  });

  if (config.rateLimit) {
    // Runs after authentication, so signed-in users are limited per account. Many Indian mobile
    // users share one carrier IP (CGNAT), so per-IP limits stay generous and apply only to
    // anonymous requests. Per-email limits on sign-in codes live in the database.
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => (req.userId ? `u:${req.userId}` : `ip:${req.ip}`),
    });
  }

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: 'rate_limited', message: 'Slow down and try again shortly.' });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message ?? 'Bad request' });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Route not found' }));

  const adminKey = config.adminApiKey ? Buffer.from(config.adminApiKey) : null;
  const ctx: AppContext = {
    config,
    db,
    mailer: deps.mailer ?? createMailer(config, app.log),
    now: deps.now ?? (() => new Date()),
    requireUser: (req) => {
      if (!req.userId) throw unauthorized();
      return req.userId;
    },
    requireAdmin: (req) => {
      const given = req.headers['x-admin-key'];
      if (!adminKey || typeof given !== 'string') throw forbidden('admin_only');
      const g = Buffer.from(given);
      if (g.length !== adminKey.length || !timingSafeEqual(g, adminKey)) throw forbidden('admin_only');
    },
  };

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  await registerRoutes(app, ctx);
  return app;
}
