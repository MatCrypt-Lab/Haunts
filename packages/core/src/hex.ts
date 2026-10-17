/**
 * Hexagonal grid over Web Mercator.
 *
 * Every point on Earth maps to exactly one pointy-top hexagon ("cell"). Cells are
 * identified by their axial coordinates as the string `"q_r"`. The grid is pure math,
 * so the phone and the server always agree on cell ids without any lookup table.
 *
 * CELL_SIZE_M is the circumradius in *Mercator* metres. On the ground a cell is
 * CELL_SIZE_M * cos(latitude) across its circumradius, about 58 m in Bengaluru, so a cell
 * is roughly one city block (about 100 m corner to corner).
 */

export type LatLng = { lat: number; lng: number };
export type CellId = string;
export type Axial = { q: number; r: number };

export const EARTH_RADIUS_M = 6378137;
export const MAX_MERCATOR_LAT = 85.05112878;
export const CELL_SIZE_M = 60;

const SQRT3 = Math.sqrt(3);
const DEG = Math.PI / 180;
const CELL_ID_RE = /^-?\d{1,7}_-?\d{1,7}$/;

export function project({ lat, lng }: LatLng): { x: number; y: number } {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const x = EARTH_RADIUS_M * lng * DEG;
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clampedLat * DEG) / 2));
  return { x, y };
}

export function unproject(x: number, y: number): LatLng {
  const lng = x / EARTH_RADIUS_M / DEG;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) / DEG;
  return { lat, lng };
}

/** Normalises -0 to 0 so ids are stable. */
function norm(n: number): number {
  return n === 0 ? 0 : n;
}

function cubeRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: norm(q), r: norm(r) };
}

export function axialToId({ q, r }: Axial): CellId {
  return `${norm(q)}_${norm(r)}`;
}

export function isValidCellId(id: unknown): id is CellId {
  return typeof id === 'string' && CELL_ID_RE.test(id);
}

export function idToAxial(id: CellId): Axial {
  if (!isValidCellId(id)) throw new Error(`Invalid cell id: ${String(id)}`);
  const sep = id.indexOf('_', 1);
  return { q: Number(id.slice(0, sep)), r: Number(id.slice(sep + 1)) };
}

export function latLngToAxial(p: LatLng): Axial {
  const { x, y } = project(p);
  const qf = ((SQRT3 / 3) * x - (1 / 3) * y) / CELL_SIZE_M;
  const rf = ((2 / 3) * y) / CELL_SIZE_M;
  return cubeRound(qf, rf);
}

export function latLngToCell(p: LatLng): CellId {
  return axialToId(latLngToAxial(p));
}

function axialCenterXY({ q, r }: Axial): { x: number; y: number } {
  return { x: CELL_SIZE_M * SQRT3 * (q + r / 2), y: CELL_SIZE_M * 1.5 * r };
}

export function cellToLatLng(id: CellId): LatLng {
  const { x, y } = axialCenterXY(idToAxial(id));
  return unproject(x, y);
}

/**
 * Closed polygon ring as [lng, lat] pairs (GeoJSON order), 7 points.
 * `scale` < 1 shrinks the hexagon around its centre, used for a gridded look.
 */
export function cellBoundary(id: CellId, scale = 1): [number, number][] {
  const { x, y } = axialCenterXY(idToAxial(id));
  const ring: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (60 * i - 30) * DEG;
    const p = unproject(x + CELL_SIZE_M * scale * Math.cos(angle), y + CELL_SIZE_M * scale * Math.sin(angle));
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]!);
  return ring;
}

const NEIGHBOUR_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function cellNeighbours(id: CellId): CellId[] {
  const { q, r } = idToAxial(id);
  return NEIGHBOUR_DIRS.map((d) => axialToId({ q: q + d.q, r: r + d.r }));
}

export function gridDistance(a: CellId, b: CellId): number {
  const A = idToAxial(a);
  const B = idToAxial(b);
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** All cells within k steps of the centre, including the centre. */
export function cellDisk(id: CellId, k: number): CellId[] {
  const { q, r } = idToAxial(id);
  const out: CellId[] = [];
  for (let dq = -k; dq <= k; dq++) {
    for (let dr = Math.max(-k, -dq - k); dr <= Math.min(k, -dq + k); dr++) {
      out.push(axialToId({ q: q + dq, r: r + dr }));
    }
  }
  return out;
}

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Cells crossed by the straight line from a to b (inclusive of both ends), in order.
 * Sampling every third of a cell in Mercator space guarantees consecutive cells touch.
 */
export function cellsAlongSegment(a: LatLng, b: LatLng): CellId[] {
  const pa = project(a);
  const pb = project(b);
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const steps = Math.max(1, Math.ceil(len / (CELL_SIZE_M / 3)));
  const out: CellId[] = [];
  let last = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = unproject(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t);
    const id = latLngToCell(p);
    if (id !== last) {
      out.push(id);
      last = id;
    }
  }
  return out;
}

/** Enumerates every cell whose centre lies inside a lat/lng bounding box. */
export function cellsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
  visit: (id: CellId, centre: LatLng) => void,
): void {
  const sw = project({ lat: south, lng: west });
  const ne = project({ lat: north, lng: east });
  const rMin = Math.floor((2 / 3) * (sw.y / CELL_SIZE_M)) - 1;
  const rMax = Math.ceil((2 / 3) * (ne.y / CELL_SIZE_M)) + 1;
  for (let r = rMin; r <= rMax; r++) {
    const qMin = Math.floor(sw.x / (CELL_SIZE_M * SQRT3) - r / 2) - 1;
    const qMax = Math.ceil(ne.x / (CELL_SIZE_M * SQRT3) - r / 2) + 1;
    for (let q = qMin; q <= qMax; q++) {
      const { x, y } = axialCenterXY({ q, r });
      if (x < sw.x || x > ne.x || y < sw.y || y > ne.y) continue;
      visit(axialToId({ q, r }), unproject(x, y));
    }
  }
}
