import * as SQLite from 'expo-sqlite';
import { createSerialQueue } from './serial';

/**
 * On-device store. `cells` is the user's revealed map (union of local and server cells).
 * `pending` is the upload queue of (cell, day) pairs. Nothing here contains raw coordinates
 * except the last fix in `kv`, which is needed to fill gaps between GPS points.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('unfog.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cells (cell TEXT PRIMARY KEY NOT NULL, first_day TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending (cell TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (cell, day));
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

    -- Private memory. Never uploaded except inside the encrypted backup.
    -- Raw fixes are kept for about a week, then compacted into simplified day paths.
    CREATE TABLE IF NOT EXISTS fixes (t INTEGER PRIMARY KEY NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, day TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS fixes_day ON fixes (day);
    CREATE TABLE IF NOT EXISTS day_paths (day TEXT PRIMARY KEY NOT NULL, segments TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stays (
      start_t INTEGER PRIMARY KEY NOT NULL, end_t INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
      cell TEXT NOT NULL, day TEXT NOT NULL, place_id TEXT
    );
    CREATE INDEX IF NOT EXISTS stays_day ON stays (day);
    CREATE INDEX IF NOT EXISTS stays_place ON stays (place_id);
    CREATE INDEX IF NOT EXISTS stays_cell ON stays (cell);
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, emoji TEXT, note TEXT,
      lat REAL NOT NULL, lng REAL NOT NULL, created_at INTEGER NOT NULL
    );
    -- Reverse-geocoded names, keyed by map block, so each block is looked up once.
    CREATE TABLE IF NOT EXISTS geo_names (cell TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
  `);
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

const CHUNK = 400; // stays well under SQLite's bound-parameter limit

/**
 * All writes go through one queue. The background task, the live map watcher and uploads can
 * run at the same time on the same connection, and SQLite rejects a second BEGIN while a
 * transaction is open ("cannot start a transaction within a transaction").
 */
const writeQueue = createSerialQueue();
export function serialWrite<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  return writeQueue(async () => fn(await getDb()));
}

export async function addVisits(pairs: { cell: string; day: string }[]): Promise<number> {
  if (pairs.length === 0) return 0;
  return serialWrite(async (db) => {
    let added = 0;
    await db.withTransactionAsync(async () => {
      for (let i = 0; i < pairs.length; i += CHUNK) {
        const chunk = pairs.slice(i, i + CHUNK);
        const params = chunk.flatMap((p) => [p.cell, p.day]);
        const ph = chunk.map(() => '(?, ?)').join(',');
        await db.runAsync(`INSERT OR IGNORE INTO pending (cell, day) VALUES ${ph}`, params);
        const r = await db.runAsync(`INSERT OR IGNORE INTO cells (cell, first_day) VALUES ${ph}`, params);
        added += r.changes;
      }
    });
    return added;
  });
}

export async function mergeServerCells(cells: [string, string][]): Promise<number> {
  if (cells.length === 0) return 0;
  return serialWrite(async (db) => {
    let added = 0;
    await db.withTransactionAsync(async () => {
      for (let i = 0; i < cells.length; i += CHUNK) {
        const chunk = cells.slice(i, i + CHUNK);
        const r = await db.runAsync(
          `INSERT OR IGNORE INTO cells (cell, first_day) VALUES ${chunk.map(() => '(?, ?)').join(',')}`,
          chunk.flat(),
        );
        added += r.changes;
      }
    });
    return added;
  });
}

export async function getAllCells(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ cell: string }>('SELECT cell FROM cells');
  return rows.map((r) => r.cell);
}

export async function countCells(): Promise<number> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM cells'))?.n ?? 0;
}

export async function removeCells(cells: string[]): Promise<void> {
  if (cells.length === 0) return;
  await serialWrite((db) =>
    db.withTransactionAsync(async () => {
      for (let i = 0; i < cells.length; i += CHUNK) {
        const chunk = cells.slice(i, i + CHUNK);
        const ph = chunk.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM cells WHERE cell IN (${ph})`, chunk);
        await db.runAsync(`DELETE FROM pending WHERE cell IN (${ph})`, chunk);
      }
    }),
  );
}

export async function peekPending(limit: number): Promise<{ cell: string; day: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ cell: string; day: string }>('SELECT cell, day FROM pending ORDER BY day LIMIT ?', [limit]);
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM pending'))?.n ?? 0;
}

export async function deletePending(pairs: { cell: string; day: string }[]): Promise<void> {
  if (pairs.length === 0) return;
  await serialWrite((db) =>
    db.withTransactionAsync(async () => {
      for (let i = 0; i < pairs.length; i += CHUNK) {
        const chunk = pairs.slice(i, i + CHUNK);
        await db.runAsync(
          `DELETE FROM pending WHERE (cell, day) IN (VALUES ${chunk.map(() => '(?, ?)').join(',')})`,
          chunk.flatMap((p) => [p.cell, p.day]),
        );
      }
    }),
  );
}

export async function deletePendingBefore(day: string): Promise<void> {
  await serialWrite((db) => db.runAsync('DELETE FROM pending WHERE day < ?', [day]));
}

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]))?.value ?? null;
}

export async function kvSet(key: string, value: string | null): Promise<void> {
  await serialWrite(async (db) => {
    if (value === null) await db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
    else
      await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        value,
      ]);
  });
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGet(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: string, value: unknown): Promise<void> {
  await kvSet(key, value === null ? null : JSON.stringify(value));
}

/** Read-modify-write of a JSON value as one atomic step. Returns the previous value. */
export async function kvUpdateJson<T>(key: string, update: (current: T | null) => T | null): Promise<T | null> {
  return serialWrite(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    let current: T | null = null;
    try {
      current = row ? (JSON.parse(row.value) as T) : null;
    } catch {
      current = null;
    }
    const next = update(current);
    if (next === null) await db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
    else
      await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        JSON.stringify(next),
      ]);
    return current;
  });
}

/** Wipes everything on sign-out or account deletion, including the private memory. */
export async function clearLocalData(): Promise<void> {
  await serialWrite((db) =>
    db.execAsync(
      'DELETE FROM cells; DELETE FROM pending; DELETE FROM kv; DELETE FROM fixes; DELETE FROM day_paths; DELETE FROM stays; DELETE FROM places; DELETE FROM geo_names;',
    ),
  );
}
