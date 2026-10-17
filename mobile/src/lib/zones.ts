import { cellDisk, cellInZones, latLngToCell, type PrivacyZone } from '@unfog/core';
import { api } from './api';
import { emit } from './events';
import { getAllCells, kvGetJson, kvSetJson, kvUpdateJson, removeCells } from './local-db';
import { locationPipeline } from './serial';
import { flushPending } from './sync';

const ZONES_KEY = 'privacy_zones';
const RETRY_KEY = 'forget_retry';
const FORGET_CHUNK = 5000;

/** Privacy zones live only on this phone. The server never learns where they are. */
export async function getZones(): Promise<PrivacyZone[]> {
  return (await kvGetJson<PrivacyZone[]>(ZONES_KEY)) ?? [];
}

/** Every cell that touches the zone, whether or not this phone has seen it. */
function cellsCoveredBy(zone: PrivacyZone, known: readonly string[]): string[] {
  const k = Math.ceil(zone.radiusM / 50) + 2;
  const candidates = new Set([...known, ...cellDisk(latLngToCell(zone), k)]);
  return [...candidates].filter((c) => cellInZones(c, [zone]));
}

/** Queues cells to erase on the server, merged with anything already waiting. */
export async function queueForget(cells: readonly string[]): Promise<void> {
  if (cells.length === 0) return;
  await kvUpdateJson<string[]>(RETRY_KEY, (current) => [...new Set([...(current ?? []), ...cells])]);
}

/** Sends queued forget requests in chunks, removing only the chunks the server accepted. */
export async function retryForget(): Promise<number> {
  let removed = 0;
  for (let guard = 0; guard < 100; guard++) {
    const queued = (await kvGetJson<string[]>(RETRY_KEY)) ?? [];
    if (queued.length === 0) break;
    const chunk = queued.slice(0, FORGET_CHUNK);
    const r = await api<{ removed: number }>('/me/cells/forget', { method: 'POST', body: { cells: chunk } });
    removed += r.removed;
    const sent = new Set(chunk);
    await kvUpdateJson<string[]>(RETRY_KEY, (current) => {
      const left = (current ?? []).filter((c) => !sent.has(c));
      return left.length ? left : null;
    });
  }
  return removed;
}

/**
 * Adds a zone and erases everything already recorded inside it, on this phone and on the
 * server. Only cell ids are sent, never the zone's centre or radius.
 */
export async function addZone(zone: PrivacyZone): Promise<{ removed: number }> {
  const inside = await locationPipeline(async () => {
    await kvSetJson(ZONES_KEY, [...(await getZones()), zone]);
    const known = await getAllCells();
    const covered = cellsCoveredBy(zone, known);
    await removeCells(covered);
    await queueForget(covered);
    const knownSet = new Set(known);
    return covered.filter((c) => knownSet.has(c)).length;
  });
  emit('cells');

  // An upload that started before the zone existed may still carry cells inside it. Let it
  // land first so the forget request removes them afterwards.
  await flushPending().catch(() => {});
  let removed = inside;
  try {
    removed = Math.max(removed, await retryForget());
  } catch {
    // Still queued; retried after the next successful upload.
  }
  return { removed };
}

export async function removeZone(id: string): Promise<void> {
  await locationPipeline(async () => {
    await kvSetJson(ZONES_KEY, (await getZones()).filter((z) => z.id !== id));
  });
}
