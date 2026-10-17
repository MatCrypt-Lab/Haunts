import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (code = 'forbidden', message?: string) => new HttpError(403, code, message);
export const notFound = (code = 'not_found', message?: string) => new HttpError(404, code, message);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
export const gone = (code: string, message?: string) => new HttpError(410, code, message);
export const tooMany = (code: string, message?: string) => new HttpError(429, code, message);

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'invalid_request',
      r.error.issues[0]?.message ?? 'Invalid request',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
