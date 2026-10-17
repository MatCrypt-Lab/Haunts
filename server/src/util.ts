import { createHash, randomBytes, randomInt } from 'node:crypto';

// No 0/O or 1/I/L, so codes survive being read aloud or handwritten.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

export function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}
