// Real Bengaluru data from the app's shared package: the same 60 m hex grid the phone paints,
// and the 65 neighbourhood anchors the game uses for territory.
import { axialToId, cellToLatLng, latLngToAxial, project, CELL_SIZE_M } from '../../packages/core/src/hex';
import { BENGALURU } from '../../packages/core/src/cities/bengaluru';
import { neighbourhoodForPoint } from '../../packages/core/src/cities/index';
import { CITY_STATS } from '../../packages/core/src/cities/stats.generated';

export const CITY_TOTAL_BLOCKS = CITY_STATS.blr!.totalCells;
export const NEIGHBOURHOOD_COUNT = BENGALURU.neighbourhoods.length;
export const BLOCK_M = CELL_SIZE_M;

/** Map window shown in the hero: central Bengaluru around Koramangala and Indiranagar. */
const CENTER = { lat: 12.952, lng: 77.62 };
const RADIUS_M = 4600;
/** Scene units: 1 unit = 100 Mercator metres. */
const UNIT = 100;

export type CityGrid = {
  count: number;
  x: Float32Array;
  z: Float32Array;
  q: Int32Array;
  r: Int32Array;
  nb: Int16Array;
  index: Map<string, number>;
  hood: { id: string; name: string; x: number; z: number }[];
};

export function buildGrid(): CityGrid {
  const c = project(CENTER);
  const ac = latLngToAxial(CENTER);
  const span = Math.ceil(RADIUS_M / (CELL_SIZE_M * 1.5)) + 2;
  const xs: number[] = [], zs: number[] = [], qs: number[] = [], rs: number[] = [], nbs: number[] = [];
  const hoods = BENGALURU.neighbourhoods;
  const index = new Map<string, number>();
  for (let r = ac.r - span; r <= ac.r + span; r++) {
    for (let q = ac.q - span * 2; q <= ac.q + span * 2; q++) {
      const ll = cellToLatLng(axialToId({ q, r }));
      const p = project(ll);
      const dx = p.x - c.x, dy = p.y - c.y;
      if (dx * dx + dy * dy > RADIUS_M * RADIUS_M) continue;
      const n = neighbourhoodForPoint(BENGALURU, ll);
      index.set(`${q}_${r}`, xs.length);
      xs.push(dx / UNIT);
      zs.push(-dy / UNIT);
      qs.push(q);
      rs.push(r);
      nbs.push(n ? hoods.indexOf(n) : -1);
    }
  }
  const hood = hoods
    .map((n) => {
      const p = project(n);
      return { id: n.id, name: n.name, x: (p.x - c.x) / UNIT, z: -(p.y - c.y) / UNIT };
    })
    .filter((h) => h.x * h.x + h.z * h.z < (RADIUS_M / UNIT) ** 2 * 0.8);
  return {
    count: xs.length,
    x: Float32Array.from(xs),
    z: Float32Array.from(zs),
    q: Int32Array.from(qs),
    r: Int32Array.from(rs),
    nb: Int16Array.from(nbs),
    index,
    hood,
  };
}

export const NEIGHBOUR_DIRS: [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function hoodIndex(id: string): number {
  return BENGALURU.neighbourhoods.findIndex((n) => n.id === id);
}
