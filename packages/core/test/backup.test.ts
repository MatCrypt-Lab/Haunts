import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BackupError,
  base64ToBytes,
  bytesToBase64,
  decryptBackup,
  encryptBackup,
  normalizeRecoveryCode,
  recoveryCodeFromBytes,
} from '../src/backup';

const code = recoveryCodeFromBytes(new Uint8Array(randomBytes(20)));
const nonce = () => new Uint8Array(randomBytes(12));

describe('memory backup', () => {
  it('formats recovery codes as 8 groups of 4 and normalises typing mistakes', () => {
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(normalizeRecoveryCode(typed)).toBe(code.replace(/-/g, ''));
    expect(() => normalizeRecoveryCode('too-short')).toThrow(BackupError);
    expect(() => recoveryCodeFromBytes(new Uint8Array(10))).toThrow();
  });

  it('round-trips data and produces different ciphertext each time', () => {
    const data = { v: 1, places: [{ id: 'a', name: 'Café ☕', lat: 12.9, lng: 77.6 }], paths: { '2026-10-14': ['_p~iF~ps|U'] } };
    const a = encryptBackup(data, code, nonce());
    const b = encryptBackup(data, code, nonce());
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
    expect(decryptBackup(a, code)).toEqual(data);
    expect(decryptBackup(a, code.toLowerCase())).toEqual(data);
  });

  it('rejects the wrong code, tampering and foreign data', () => {
    const blob = encryptBackup({ x: 1 }, code, nonce());
    const other = recoveryCodeFromBytes(new Uint8Array(randomBytes(20)));
    expect(() => decryptBackup(blob, other)).toThrow(expect.objectContaining({ code: 'wrong_code' }));
    const tampered = blob.slice();
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decryptBackup(tampered, code)).toThrow(expect.objectContaining({ code: 'wrong_code' }));
    expect(() => decryptBackup(new Uint8Array(40), code)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => decryptBackup(new Uint8Array(5), code)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('matches Node base64 for every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(randomBytes(n));
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
  });

  it('compresses a year of memory into a small blob', () => {
    const paths: Record<string, string[]> = {};
    for (let d = 0; d < 365; d++) paths[`day${d}`] = ['_p~iF~ps|U_ulLnnqC_mqNvxq`@'.repeat(20)];
    const stays = Array.from({ length: 365 * 6 }, (_, i) => ({ start: i * 1e6, end: i * 1e6 + 3.6e6, lat: 12.93 + i * 1e-6, lng: 77.62, placeId: null, label: null }));
    const blob = encryptBackup({ v: 1, paths, stays, places: [] }, code, nonce());
    expect(blob.length).toBeLessThan(1_000_000);
  });
});
