import { haversineMeters, type LatLng } from './hex';

/**
 * Personal memory: where someone stopped and the route they took each day. This data stays
 * on the phone (and in an encrypted backup the server cannot read). It never feeds the
 * game, which only ever sees map blocks and days.
 */

export type TimedPoint = { lat: number; lng: number; t: number };
export type Stay = { start: number; end: number; lat: number; lng: number };
export type SavedPlace = { id: string; name: string; lat: number; lng: number };

export const STAY_RULES = {
  /** Points within this distance of the cluster centre belong to the same stop. */
  radiusM: 100,
  /** Shorter stops are just pauses on the way. */
  minDurationMs: 5 * 60_000,
  /** Used to estimate when someone left: the next fix minus the walk to reach it. */
  walkSpeedMps: 1.4,
  /** A silence longer than this (phone off, app closed) is not assumed to be a stay. */
  maxGapMs: 12 * 3_600_000,
} as const;

export const PLACE_MATCH_RADIUS_M = 80;

type Cluster = { start: number; last: number; sumLat: number; sumLng: number; n: number };

function centre(c: Cluster): LatLng {
  return { lat: c.sumLat / c.n, lng: c.sumLng / c.n };
}

/**
 * Finds stops in a series of fixes. Background location goes quiet while the phone is still
 * (updates fire only after moving about 40 m), so a stop is usually one fix followed by a
 * long silence. The stop is assumed to last until the next fix, minus the time it takes to
 * walk there.
 */
export function detectStays(points: readonly TimedPoint[]): Stay[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const stays: Stay[] = [];
  let c: Cluster | null = null;

  const close = (cl: Cluster, end: number) => {
    if (end - cl.start >= STAY_RULES.minDurationMs) {
      const p = centre(cl);
      stays.push({ start: cl.start, end, lat: p.lat, lng: p.lng });
    }
  };
  const open = (p: TimedPoint): Cluster => ({ start: p.t, last: p.t, sumLat: p.lat, sumLng: p.lng, n: 1 });

  for (const p of sorted) {
    if (!c) {
      c = open(p);
      continue;
    }
    const gap = p.t - c.last;
    const d = haversineMeters(centre(c), p);
    if (gap > STAY_RULES.maxGapMs) {
      close(c, c.last);
      c = open(p);
    } else if (d <= STAY_RULES.radiusM) {
      c.sumLat += p.lat;
      c.sumLng += p.lng;
      c.n++;
      c.last = p.t;
    } else {
      const left = p.t - (d / STAY_RULES.walkSpeedMps) * 1000;
      close(c, Math.max(c.last, Math.min(left, p.t)));
      c = open(p);
    }
  }
  if (c) close(c, c.last);
  return stays;
}

/** The nearest saved place within PLACE_MATCH_RADIUS_M, if any. */
export function matchPlace<P extends SavedPlace>(p: LatLng, places: readonly P[]): P | undefined {
  let best: P | undefined;
  let bestD = Infinity;
  for (const pl of places) {
    const d = haversineMeters(p, pl);
    if (d < bestD) {
      bestD = d;
      best = pl;
    }
  }
  return bestD <= PLACE_MATCH_RADIUS_M ? best : undefined;
}

/** Splits a day's fixes into continuous segments wherever there is a jump or long silence. */
export function splitSegments(points: readonly TimedPoint[], maxGapMs = 15 * 60_000, maxJumpM = 1000): TimedPoint[][] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const segments: TimedPoint[][] = [];
  let cur: TimedPoint[] = [];
  for (const p of sorted) {
    const prev = cur[cur.length - 1];
    if (prev && (p.t - prev.t > maxGapMs || haversineMeters(prev, p) > maxJumpM)) {
      if (cur.length > 1) segments.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length > 1) segments.push(cur);
  return segments;
}

/** Douglas-Peucker simplification with a tolerance in metres. Keeps the first and last point. */
export function simplifyPath(points: readonly LatLng[], toleranceM = 15): LatLng[] {
  if (points.length <= 2) return [...points];
  const lat0 = (points[0]!.lat * Math.PI) / 180;
  const xy = points.map((p) => ({ x: p.lng * 111320 * Math.cos(lat0), y: p.lat * 110574 }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = xy[a]!;
    const B = xy[b]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = xy[i]!;
      let d: number;
      if (len2 === 0) d = Math.hypot(P.x - A.x, P.y - A.y);
      else {
        const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
        d = Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Google's encoded polyline format, precision 5 (about 1 m). Compact for storage and backup. */
export function encodePolyline(points: readonly LatLng[]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (i >= str.length) throw new Error('Truncated polyline');
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** "2h 15m", "45m", "under 5m". */
export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 5) return 'under 5m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${m}m`;
}
