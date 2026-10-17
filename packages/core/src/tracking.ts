import { TRACKING } from './constants';
import { cellsAlongSegment, haversineMeters, latLngToCell, type CellId } from './hex';
import { cellInZones, pointInZones, type PrivacyZone } from './privacy';

export type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; timestamp: number };
export type LastFix = { lat: number; lng: number; t: number } | null;
export type Visit = { cell: CellId; day: string };

/**
 * Turns raw GPS fixes into (cell, day) visits. Runs on the phone before anything is stored.
 *
 * - Drops inaccurate fixes and anything faster than TRACKING.maxSpeedMps.
 * - Drops fixes inside privacy zones and never draws a line into or out of one.
 * - Fills the cells between two close fixes so a walk paints a continuous trail.
 */
export function fixesToVisits(
  fixes: readonly Fix[],
  last: LastFix,
  zones: readonly PrivacyZone[],
  dayOf: (timestamp: number) => string,
): { visits: Visit[]; last: LastFix; accepted: Fix[] } {
  const sorted = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set<string>();
  const visits: Visit[] = [];
  /** Fixes that passed every filter, for the on-device memory. */
  const accepted: Fix[] = [];
  // A batch can arrive late, after a newer fix was processed (Android delivers buffered
  // background fixes on resume). Record it, but do not join it to the newer fix.
  const lateBatch = last !== null && sorted.length > 0 && sorted[0]!.timestamp < last.t;
  let prev = lateBatch ? null : last;

  for (const f of sorted) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) continue;
    if (f.accuracy !== null && f.accuracy > TRACKING.maxAccuracyM) continue;
    if (f.speed !== null && f.speed > TRACKING.maxSpeedMps) {
      prev = null;
      continue;
    }
    const p = { lat: f.lat, lng: f.lng };
    if (pointInZones(p, zones)) {
      prev = null;
      continue;
    }

    let cells: CellId[] = [latLngToCell(p)];
    if (prev) {
      const dt = f.timestamp - prev.t;
      const d = haversineMeters(prev, p);
      const impliedSpeed = dt > 0 ? d / (dt / 1000) : Infinity;
      if (d > 0 && dt <= TRACKING.maxGapMs && d <= TRACKING.maxGapM && impliedSpeed <= TRACKING.maxSpeedMps) {
        cells = cellsAlongSegment(prev, p);
      } else if (impliedSpeed > TRACKING.maxSpeedMps && d > TRACKING.maxGapM) {
        // A jump (teleport glitch or flight). Keep the fix but do not connect it.
        cells = [latLngToCell(p)];
      }
    }
    if (zones.length > 0) cells = cells.filter((c) => !cellInZones(c, zones));

    accepted.push(f);
    const day = dayOf(f.timestamp);
    for (const cell of cells) {
      const k = `${cell}|${day}`;
      if (seen.has(k)) continue;
      seen.add(k);
      visits.push({ cell, day });
    }
    prev = { lat: f.lat, lng: f.lng, t: f.timestamp };
  }
  // Keep whichever fix is newest as the anchor for the next batch.
  const newest = last && (!prev || last.t >= prev.t) ? (lateBatch ? last : prev) : prev;
  return { visits, last: newest, accepted };
}
