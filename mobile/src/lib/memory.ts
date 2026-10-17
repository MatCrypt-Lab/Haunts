import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import {
  BackupError,
  addDays,
  base64ToBytes,
  bytesToBase64,
  decodePolyline,
  decryptBackup,
  detectStays,
  deviceDayKey,
  encodePolyline,
  encryptBackup,
  haversineMeters,
  isValidDayKey,
  latLngToCell,
  matchPlace,
  normalizeRecoveryCode,
  PLACE_MATCH_RADIUS_M,
  recoveryCodeFromBytes,
  RECOVERY_CODE_BYTES,
  simplifyPath,
  splitSegments,
  STAY_RULES,
  type Fix,
  type LatLng,
  type MemoryBackup,
  type MemoryBackupInfo,
  type MemoryDump,
  type TimedPoint,
} from '@unfog/core';
import { ApiError, api } from './api';
import { emit } from './events';
import { getDb, kvGet, kvSet, serialWrite } from './local-db';

/**
 * The private memory: where you stopped, for how long, and the route you took. It is built
 * from the same fixes as the game but kept only on this phone, plus an optional backup that
 * is encrypted before it leaves the phone.
 */

const RAW_KEEP_DAYS = 7;
const STAY_WINDOW_MS = 48 * 3_600_000;
const CHUNK = 150;

export type Place = { id: string; name: string; emoji: string | null; note: string | null; lat: number; lng: number; createdAt: number };
export type PlaceSummary = Place & { visits: number; totalMs: number; firstVisit: number | null; lastVisit: number | null };
export type StayView = {
  start: number;
  end: number;
  lat: number;
  lng: number;
  cell: string;
  placeId: string | null;
  /** Saved place name, else the reverse-geocoded name, else null. */
  name: string | null;
  emoji: string | null;
  saved: boolean;
};
export type DayView = { day: string; stays: StayView[]; segments: LatLng[][] };
export type SearchResult =
  | { kind: 'place'; id: string; name: string; emoji: string | null; lastVisit: number | null }
  | { kind: 'spot'; name: string; day: string; start: number };
export type Memory = { label: string; day: string; stops: number; topName: string | null };

function newId(): string {
  return Array.from(Crypto.getRandomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- recording

/** Stores fixes that passed the tracking filters (already outside private zones). */
export async function recordFixes(fixes: readonly Fix[]): Promise<void> {
  if (fixes.length === 0) return;
  await serialWrite((db) =>
    db.withTransactionAsync(async () => {
      for (let i = 0; i < fixes.length; i += CHUNK) {
        const chunk = fixes.slice(i, i + CHUNK);
        await db.runAsync(
          `INSERT OR IGNORE INTO fixes (t, lat, lng, day) VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(',')}`,
          chunk.flatMap((f) => [Math.round(f.timestamp), f.lat, f.lng, deviceDayKey(f.timestamp)]),
        );
      }
    }),
  );
}

/**
 * Recomputes stops for the last two days. The window starts at the earliest stop that
 * overlaps it, so a stop is never cut in half. While the phone has been still since its last
 * fix, the current stop runs until now.
 */
export async function rebuildRecentStays(now = Date.now()): Promise<void> {
  await serialWrite(async (db) => {
    const from = now - STAY_WINDOW_MS;
    const overlap = await db.getFirstAsync<{ s: number | null }>('SELECT min(start_t) AS s FROM stays WHERE end_t >= ?', [from]);
    const windowStart = Math.min(from, overlap?.s ?? from);
    const pts = await db.getAllAsync<TimedPoint>('SELECT t, lat, lng FROM fixes WHERE t >= ? ORDER BY t', [windowStart]);
    const last = pts[pts.length - 1];
    if (last && now - last.t >= STAY_RULES.minDurationMs && now - last.t < STAY_RULES.maxGapMs) {
      pts.push({ lat: last.lat, lng: last.lng, t: now });
    }
    const stays = detectStays(pts);
    const places = await loadPlaces(db);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM stays WHERE start_t >= ?', [windowStart]);
      for (const s of stays) {
        await db.runAsync('INSERT OR REPLACE INTO stays (start_t, end_t, lat, lng, cell, day, place_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          s.start,
          s.end,
          s.lat,
          s.lng,
          latLngToCell(s),
          deviceDayKey(s.start),
          matchPlace(s, places)?.id ?? null,
        ]);
      }
    });
  });
}

/** Rebuilds stops at most every two minutes; called after each batch of fixes. */
export async function maybeRebuildStays(): Promise<void> {
  const last = Number((await kvGet('stays_rebuilt_at')) ?? 0);
  if (Date.now() - last < 2 * 60_000) return;
  await kvSet('stays_rebuilt_at', String(Date.now()));
  await rebuildRecentStays();
}

function segmentsFromPoints(pts: readonly TimedPoint[]): LatLng[][] {
  return splitSegments(pts).map((seg) => simplifyPath(seg));
}

/** Turns raw fixes older than a week into simplified, encoded day paths. */
export async function compactOldDays(today = deviceDayKey()): Promise<number> {
  const cutoff = addDays(today, -RAW_KEEP_DAYS);
  return serialWrite(async (db) => {
    const days = await db.getAllAsync<{ day: string }>('SELECT DISTINCT day FROM fixes WHERE day < ?', [cutoff]);
    for (const { day } of days) {
      const pts = await db.getAllAsync<TimedPoint>('SELECT t, lat, lng FROM fixes WHERE day = ? ORDER BY t', [day]);
      const encoded = segmentsFromPoints(pts).map(encodePolyline);
      const existing = await db.getFirstAsync<{ segments: string }>('SELECT segments FROM day_paths WHERE day = ?', [day]);
      const merged = [...(existing ? (JSON.parse(existing.segments) as string[]) : []), ...encoded];
      await db.withTransactionAsync(async () => {
        await db.runAsync('INSERT OR REPLACE INTO day_paths (day, segments) VALUES (?, ?)', [day, JSON.stringify(merged)]);
        await db.runAsync('DELETE FROM fixes WHERE day = ?', [day]);
      });
    }
    return days.length;
  });
}

// ---------------------------------------------------------------- reading

type Db = Awaited<ReturnType<typeof getDb>>;

async function loadPlaces(db: Db): Promise<Place[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; emoji: string | null; note: string | null; lat: number; lng: number; created_at: number }>(
    'SELECT id, name, emoji, note, lat, lng, created_at FROM places',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, note: r.note, lat: r.lat, lng: r.lng, createdAt: r.created_at }));
}

type StayRow = { start_t: number; end_t: number; lat: number; lng: number; cell: string; place_id: string | null; pname: string | null; emoji: string | null; gname: string | null };

function toStayView(r: StayRow): StayView {
  return {
    start: r.start_t,
    end: r.end_t,
    lat: r.lat,
    lng: r.lng,
    cell: r.cell,
    placeId: r.place_id,
    name: r.pname ?? r.gname,
    emoji: r.emoji,
    saved: r.pname !== null,
  };
}

const STAY_SELECT = `SELECT s.start_t, s.end_t, s.lat, s.lng, s.cell, s.place_id, p.name AS pname, p.emoji, g.name AS gname
  FROM stays s LEFT JOIN places p ON p.id = s.place_id LEFT JOIN geo_names g ON g.cell = s.cell`;

export async function getDay(day: string): Promise<DayView> {
  const db = await getDb();
  const stays = (await db.getAllAsync<StayRow>(`${STAY_SELECT} WHERE s.day = ? ORDER BY s.start_t`, [day])).map(toStayView);
  const stored = await db.getFirstAsync<{ segments: string }>('SELECT segments FROM day_paths WHERE day = ?', [day]);
  const raw = await db.getAllAsync<TimedPoint>('SELECT t, lat, lng FROM fixes WHERE day = ? ORDER BY t', [day]);
  const segments = [...(stored ? (JSON.parse(stored.segments) as string[]).map(decodePolyline) : []), ...segmentsFromPoints(raw)];
  return { day, stays, segments };
}

/** Days that have anything recorded, newest first. */
export async function activeDays(limit = 400): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ day: string }>(
    `SELECT day FROM (SELECT day FROM stays UNION SELECT day FROM day_paths UNION SELECT day FROM fixes) ORDER BY day DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.day);
}

/**
 * Names stops that have no saved place using the phone's geocoder. Runs in the foreground
 * only, caches by map block, and stops quietly if the geocoder is unavailable.
 */
export async function nameStays(stays: readonly StayView[], max = 8): Promise<number> {
  const todo = stays.filter((s) => !s.name).slice(0, max);
  let named = 0;
  for (const s of todo) {
    try {
      const [a] = await Location.reverseGeocodeAsync({ latitude: s.lat, longitude: s.lng });
      if (!a) continue;
      const parts = [a.name && a.name !== a.streetNumber ? a.name : a.street, a.district ?? a.subregion ?? a.city].filter(
        (x, i, arr): x is string => !!x && arr.indexOf(x) === i,
      );
      if (parts.length === 0) continue;
      await serialWrite((db) => db.runAsync('INSERT OR REPLACE INTO geo_names (cell, name) VALUES (?, ?)', [s.cell, parts.join(', ')]));
      named++;
    } catch {
      return named;
    }
  }
  return named;
}

export async function listPlaces(): Promise<PlaceSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    emoji: string | null;
    note: string | null;
    lat: number;
    lng: number;
    created_at: number;
    visits: number;
    total: number;
    first: number | null;
    last: number | null;
  }>(
    `SELECT p.id, p.name, p.emoji, p.note, p.lat, p.lng, p.created_at, count(s.start_t) AS visits,
            coalesce(sum(s.end_t - s.start_t), 0) AS total, min(s.start_t) AS first, max(s.start_t) AS last
     FROM places p LEFT JOIN stays s ON s.place_id = p.id
     GROUP BY p.id ORDER BY last DESC NULLS LAST, p.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    note: r.note,
    lat: r.lat,
    lng: r.lng,
    createdAt: r.created_at,
    visits: r.visits,
    totalMs: r.total,
    firstVisit: r.first,
    lastVisit: r.last,
  }));
}

export async function getPlace(id: string): Promise<{ place: PlaceSummary; visits: StayView[] } | null> {
  const place = (await listPlaces()).find((p) => p.id === id);
  if (!place) return null;
  const db = await getDb();
  const visits = (await db.getAllAsync<StayRow>(`${STAY_SELECT} WHERE s.place_id = ? ORDER BY s.start_t DESC LIMIT 500`, [id])).map(toStayView);
  return { place, visits };
}

/** Spots you keep going back to that you have not named yet. */
export async function suggestions(): Promise<{ cell: string; lat: number; lng: number; visits: number; name: string | null }[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT s.cell, avg(s.lat) AS lat, avg(s.lng) AS lng, count(*) AS visits, g.name
     FROM stays s LEFT JOIN geo_names g ON g.cell = s.cell
     WHERE s.place_id IS NULL GROUP BY s.cell HAVING count(*) >= 3 ORDER BY visits DESC LIMIT 5`,
  );
}

export async function searchMemory(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const db = await getDb();
  const places = (await listPlaces()).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.note ?? '').toLowerCase().includes(q.toLowerCase()));
  const spots = await db.getAllAsync<{ name: string; day: string; start_t: number }>(
    `SELECT g.name, s.day, max(s.start_t) AS start_t FROM stays s JOIN geo_names g ON g.cell = s.cell
     WHERE s.place_id IS NULL AND g.name LIKE ? GROUP BY g.name ORDER BY start_t DESC LIMIT 20`,
    [like],
  );
  return [
    ...places.map((p) => ({ kind: 'place' as const, id: p.id, name: p.name, emoji: p.emoji, lastVisit: p.lastVisit })),
    ...spots.map((s) => ({ kind: 'spot' as const, name: s.name, day: s.day, start: s.start_t })),
  ];
}

/** "A year ago today", "a month ago", "a week ago", when something was recorded then. */
export async function onThisDay(today = deviceDayKey()): Promise<Memory[]> {
  const [y, m, d] = today.split('-');
  const prevMonth = Number(m) === 1 ? `${Number(y) - 1}-12-${d}` : `${y}-${String(Number(m) - 1).padStart(2, '0')}-${d}`;
  const candidates = [
    { label: 'A year ago today', day: `${Number(y) - 1}-${m}-${d}` },
    { label: 'A month ago today', day: prevMonth },
    { label: 'A week ago today', day: addDays(today, -7) },
  ].filter((c) => isValidDayKey(c.day));
  const db = await getDb();
  const out: Memory[] = [];
  for (const c of candidates) {
    const rows = await db.getAllAsync<StayRow>(`${STAY_SELECT} WHERE s.day = ? ORDER BY (s.end_t - s.start_t) DESC`, [c.day]);
    if (rows.length === 0) continue;
    const views = rows.map(toStayView);
    const top = views.find((v) => v.saved) ?? views.find((v) => v.name);
    out.push({ label: c.label, day: c.day, stops: rows.length, topName: top?.name ?? null });
  }
  return out;
}

// ---------------------------------------------------------------- places

export async function savePlace(input: { name: string; emoji?: string | null; note?: string | null; lat: number; lng: number }): Promise<string> {
  const id = newId();
  await serialWrite(async (db) => {
    await db.runAsync('INSERT INTO places (id, name, emoji, note, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      input.name.trim(),
      input.emoji ?? null,
      input.note?.trim() || null,
      input.lat,
      input.lng,
      Date.now(),
    ]);
    // Attach past visits to the new place.
    const loose = await db.getAllAsync<{ start_t: number; lat: number; lng: number }>('SELECT start_t, lat, lng FROM stays WHERE place_id IS NULL');
    const near = loose.filter((s) => haversineMeters(s, input) <= PLACE_MATCH_RADIUS_M);
    for (let i = 0; i < near.length; i += CHUNK) {
      const chunk = near.slice(i, i + CHUNK);
      await db.runAsync(`UPDATE stays SET place_id = ? WHERE start_t IN (${chunk.map(() => '?').join(',')})`, [id, ...chunk.map((s) => s.start_t)]);
    }
  });
  emit('memory');
  return id;
}

export async function updatePlace(id: string, patch: { name?: string; emoji?: string | null; note?: string | null }): Promise<void> {
  await serialWrite((db) =>
    db.runAsync('UPDATE places SET name = coalesce(?, name), emoji = ?, note = ? WHERE id = ?', [
      patch.name?.trim() || null,
      patch.emoji ?? null,
      patch.note?.trim() || null,
      id,
    ]),
  );
  emit('memory');
}

export async function deletePlace(id: string): Promise<void> {
  await serialWrite((db) =>
    db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE stays SET place_id = NULL WHERE place_id = ?', [id]);
      await db.runAsync('DELETE FROM places WHERE id = ?', [id]);
    }),
  );
  emit('memory');
}

/** Erases the private memory on this phone. The game map is not affected. */
export async function deleteAllMemory(): Promise<void> {
  await serialWrite((db) => db.execAsync('DELETE FROM fixes; DELETE FROM day_paths; DELETE FROM stays; DELETE FROM places; DELETE FROM geo_names;'));
  emit('memory');
}

// ---------------------------------------------------------------- encrypted backup

const CODE_KEY = 'memory_recovery_code';
const LAST_BACKUP_KEY = 'memory_last_backup';

export type BackupStatus = { enabled: boolean; code: string | null; lastBackupAt: number | null };

export async function backupStatus(): Promise<BackupStatus> {
  const code = await kvGet(CODE_KEY);
  const last = await kvGet(LAST_BACKUP_KEY);
  return { enabled: !!code, code, lastBackupAt: last ? Number(last) : null };
}

/** Creates the recovery code that encrypts backups. Shown once; the user must save it. */
export async function createRecoveryCode(): Promise<string> {
  const code = recoveryCodeFromBytes(Crypto.getRandomBytes(RECOVERY_CODE_BYTES));
  await kvSet(CODE_KEY, code);
  return code;
}

export async function exportDump(): Promise<MemoryDump> {
  const db = await getDb();
  const places = await loadPlaces(db);
  const stays = await db.getAllAsync<{ start_t: number; end_t: number; lat: number; lng: number; place_id: string | null }>(
    'SELECT start_t, end_t, lat, lng, place_id FROM stays ORDER BY start_t',
  );
  const paths: Record<string, string[]> = {};
  for (const r of await db.getAllAsync<{ day: string; segments: string }>('SELECT day, segments FROM day_paths')) {
    paths[r.day] = JSON.parse(r.segments) as string[];
  }
  const rawDays = await db.getAllAsync<{ day: string }>('SELECT DISTINCT day FROM fixes');
  for (const { day } of rawDays) {
    const pts = await db.getAllAsync<TimedPoint>('SELECT t, lat, lng FROM fixes WHERE day = ? ORDER BY t', [day]);
    paths[day] = [...(paths[day] ?? []), ...segmentsFromPoints(pts).map(encodePolyline)];
  }
  return {
    v: 1,
    exportedAt: Date.now(),
    places,
    stays: stays.map((s) => ({ start: s.start_t, end: s.end_t, lat: s.lat, lng: s.lng, placeId: s.place_id, label: null })),
    paths,
  };
}

/** Merges a backup into this phone. Existing data is kept; nothing is overwritten. */
export async function importDump(dump: MemoryDump): Promise<void> {
  if (dump.v !== 1) throw new BackupError('unsupported');
  await serialWrite((db) =>
    db.withTransactionAsync(async () => {
      for (const p of dump.places) {
        await db.runAsync('INSERT OR IGNORE INTO places (id, name, emoji, note, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          p.id,
          p.name,
          p.emoji,
          p.note,
          p.lat,
          p.lng,
          p.createdAt,
        ]);
      }
      for (const s of dump.stays) {
        await db.runAsync('INSERT OR IGNORE INTO stays (start_t, end_t, lat, lng, cell, day, place_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          s.start,
          s.end,
          s.lat,
          s.lng,
          latLngToCell(s),
          deviceDayKey(s.start),
          s.placeId,
        ]);
      }
      for (const [day, segments] of Object.entries(dump.paths)) {
        if (!isValidDayKey(day)) continue;
        const existing = await db.getFirstAsync<{ segments: string }>('SELECT segments FROM day_paths WHERE day = ?', [day]);
        const hasRaw = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM fixes WHERE day = ?', [day]);
        // Raw fixes on this phone already describe the day better than the backup does.
        if (existing || (hasRaw?.n ?? 0) > 0) continue;
        await db.runAsync('INSERT INTO day_paths (day, segments) VALUES (?, ?)', [day, JSON.stringify(segments)]);
      }
    }),
  );
  emit('memory');
}

export async function backupNow(): Promise<MemoryBackupInfo> {
  const code = await kvGet(CODE_KEY);
  if (!code) throw new Error('Set up backup first.');
  const blob = encryptBackup(await exportDump(), code, Crypto.getRandomBytes(12));
  const info = await api<MemoryBackupInfo>('/me/memory-backup', { method: 'PUT', body: { data: bytesToBase64(blob) }, timeoutMs: 60_000 });
  await kvSet(LAST_BACKUP_KEY, String(Date.now()));
  return info;
}

/** Restores from the server with a recovery code typed by the user. */
export async function restoreBackup(codeInput: string): Promise<{ places: number; stays: number }> {
  const code = normalizeRecoveryCode(codeInput);
  let backup: MemoryBackup;
  try {
    backup = await api<MemoryBackup>('/me/memory-backup', { timeoutMs: 60_000 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new Error('There is no backup for this account yet.');
    throw err;
  }
  const dump = decryptBackup<MemoryDump>(base64ToBytes(backup.data), code);
  await importDump(dump);
  await kvSet(CODE_KEY, code.match(/.{4}/g)!.join('-'));
  await kvSet(LAST_BACKUP_KEY, String(Date.parse(backup.updatedAt)));
  return { places: dump.places.length, stays: dump.stays.length };
}

export async function backupExists(): Promise<MemoryBackupInfo | null> {
  try {
    return await api<MemoryBackupInfo>('/me/memory-backup?meta=1');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Turns backup off on this phone, and optionally deletes the copy on the server. */
export async function disableBackup(deleteFromServer: boolean): Promise<void> {
  if (deleteFromServer) await api('/me/memory-backup', { method: 'DELETE' });
  await kvSet(CODE_KEY, null);
  await kvSet(LAST_BACKUP_KEY, null);
}

/** Daily automatic backup, run when the app comes to the foreground. */
export async function maybeAutoBackup(): Promise<void> {
  const s = await backupStatus();
  if (!s.enabled) return;
  if (s.lastBackupAt && Date.now() - s.lastBackupAt < 24 * 3_600_000) return;
  await backupNow();
}

export function backupErrorMessage(err: unknown): string {
  if (err instanceof BackupError) {
    return {
      wrong_code: 'That recovery code does not unlock this backup.',
      bad_code_format: 'A recovery code is 32 letters and numbers.',
      corrupt: 'The backup is damaged and cannot be read.',
      unsupported: 'This backup needs a newer version of Haunts.',
    }[err.code];
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}
