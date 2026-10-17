import { API_URL } from './config';
import { emit } from './events';
import { getToken } from './secure';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; token?: string | null; timeoutMs?: number };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const token = opts.token === undefined ? await getToken() : opts.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach Haunts. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // Non-JSON error page from a proxy.
  }
  if (!res.ok) {
    const e = (json ?? {}) as { error?: string; message?: string };
    if (res.status === 401 && token) emit('unauthorized');
    throw new ApiError(res.status, e.error ?? 'http_error', e.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
