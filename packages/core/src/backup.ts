import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

/**
 * End-to-end encrypted memory backup. The phone encrypts with a key derived from a recovery
 * code that only the user holds; the server stores bytes it cannot read.
 *
 * Format: "UFB1" | 12-byte nonce | AES-256-GCM(gzip(JSON)), with "UFB1" as associated data.
 */

const MAGIC = strToU8('UFB1');
// Crockford base32: no I, L, O or U, so codes survive being written down.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_BYTES = 20; // 160 bits, 32 characters

export class BackupError extends Error {
  constructor(public readonly code: 'wrong_code' | 'corrupt' | 'unsupported' | 'bad_code_format') {
    super(code);
  }
}

/** 32 base32 characters shown as 8 groups of 4. */
export function recoveryCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== RECOVERY_CODE_BYTES) throw new Error(`Need ${RECOVERY_CODE_BYTES} random bytes`);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Accepts lower case, spaces, dashes, and O/I/L typed for 0/1. */
export function normalizeRecoveryCode(input: string): string {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== 32 || [...s].some((ch) => !B32.includes(ch))) throw new BackupError('bad_code_format');
  return s;
}

export function keyFromRecoveryCode(code: string): Uint8Array {
  return sha256(strToU8(`unfog-memory-backup-v1:${normalizeRecoveryCode(code)}`));
}

export function encryptBackup(data: unknown, recoveryCode: string, nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 12) throw new Error('Nonce must be 12 random bytes');
  const sealed = gcm(keyFromRecoveryCode(recoveryCode), nonce, MAGIC).encrypt(gzipSync(strToU8(JSON.stringify(data))));
  const out = new Uint8Array(MAGIC.length + nonce.length + sealed.length);
  out.set(MAGIC, 0);
  out.set(nonce, MAGIC.length);
  out.set(sealed, MAGIC.length + nonce.length);
  return out;
}

export function decryptBackup<T = unknown>(blob: Uint8Array, recoveryCode: string): T {
  const key = keyFromRecoveryCode(recoveryCode);
  if (blob.length < MAGIC.length + 12 + 16) throw new BackupError('corrupt');
  for (let i = 0; i < MAGIC.length; i++) if (blob[i] !== MAGIC[i]) throw new BackupError('unsupported');
  const nonce = blob.subarray(MAGIC.length, MAGIC.length + 12);
  let plain: Uint8Array;
  try {
    plain = gcm(key, nonce, MAGIC).decrypt(blob.subarray(MAGIC.length + 12));
  } catch {
    throw new BackupError('wrong_code');
  }
  try {
    return JSON.parse(strFromU8(gunzipSync(plain))) as T;
  } catch {
    throw new BackupError('corrupt');
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without relying on Buffer or btoa, so it behaves the same on every runtime. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** What a memory backup contains. Version it so older apps can refuse newer formats. */
export type MemoryDump = {
  v: 1;
  exportedAt: number;
  places: { id: string; name: string; emoji: string | null; note: string | null; lat: number; lng: number; createdAt: number }[];
  stays: { start: number; end: number; lat: number; lng: number; placeId: string | null; label: string | null }[];
  /** Day key to encoded polyline segments. */
  paths: Record<string, string[]>;
};
