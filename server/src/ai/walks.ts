import { cellsAlongSegment, type CellId, type LatLng } from '@unfog/core';

const WALK_M_PER_MIN = 75;
/** Streets wind: a loop through three waypoints is about this much longer than the straight lines. */
const DETOUR = 1.3;

/** Point at a distance and bearing from a start, on a flat local approximation (fine below 5 km). */
export function offset(from: LatLng, distanceM: number, bearingDeg: number): LatLng {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(b)) / 111_320;
  const dLng = (distanceM * Math.sin(b)) / (111_320 * Math.cos((from.lat * Math.PI) / 180));
  return { lat: from.lat + dLat, lng: from.lng + dLng };
}

export function cellsAlongPath(points: LatLng[]): CellId[] {
  const out = new Set<CellId>();
  for (let i = 1; i < points.length; i++) for (const c of cellsAlongSegment(points[i - 1]!, points[i]!)) out.add(c);
  return [...out];
}

export type LoopPlan = { waypoints: LatLng[]; newCells: number; drops: number; bearing: number };

/**
 * Picks the triangle-shaped loop from the start that crosses the most unexplored blocks.
 * Tries twelve orientations; each hidden drop near the path counts as five blocks.
 */
export function chooseLoop(start: LatLng, minutes: number, explored: ReadonlySet<CellId>, drops: readonly LatLng[]): LoopPlan {
  const total = Math.min(Math.max(minutes, 10), 120) * WALK_M_PER_MIN;
  // An equilateral triangle with the start as one corner has perimeter 3 * side.
  const side = total / (3 * DETOUR);
  let best: LoopPlan | null = null;
  let bestScore = -1;
  for (let bearing = 0; bearing < 360; bearing += 30) {
    const a = offset(start, side, bearing);
    const b = offset(start, side, bearing + 60);
    const path = [start, a, b, start];
    const cells = cellsAlongPath(path);
    const fresh = cells.filter((c) => !explored.has(c)).length;
    const near = drops.filter((d) => path.some((p, i) => i > 0 && distanceToSegment(d, path[i - 1]!, p) < 120)).length;
    const score = fresh + near * 5;
    if (score > bestScore) {
      bestScore = score;
      best = { waypoints: [a, b], newCells: fresh, drops: near, bearing };
    }
  }
  return best!;
}

function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  // Project onto the segment in a local metric frame.
  const k = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const ax = 0, ay = 0;
  const bx = (b.lng - a.lng) * k, by = (b.lat - a.lat) * 111_320;
  const px = (p.lng - a.lng) * k, py = (p.lat - a.lat) * 111_320;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Counts unexplored blocks and hidden drops on the real route the walker will take. */
export function scoreRoute(coordinates: [number, number][], explored: ReadonlySet<CellId>, dropCells: ReadonlySet<CellId>) {
  const cells = cellsAlongPath(coordinates.map(([lng, lat]) => ({ lat, lng })));
  return {
    newBlocks: cells.filter((c) => !explored.has(c)).length,
    dropsOnRoute: cells.filter((c) => dropCells.has(c)).length,
  };
}
