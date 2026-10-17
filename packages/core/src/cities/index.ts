import { cellToLatLng, cellsInBBox, type CellId, type LatLng } from '../hex';
import { BENGALURU } from './bengaluru';
import { CITY_STATS } from './stats.generated';
import type { CityBBox, CityDefinition, CityStats, Neighbourhood } from './types';

export type { CityBBox, CityDefinition, CityStats, Neighbourhood } from './types';

export const CITIES: readonly CityDefinition[] = [BENGALURU];
export const DEFAULT_CITY_ID = BENGALURU.id;

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQ = 111320;

export function getCity(id: string): CityDefinition | undefined {
  return CITIES.find((c) => c.id === id);
}

export function getNeighbourhood(city: CityDefinition, id: string): Neighbourhood | undefined {
  return city.neighbourhoods.find((n) => n.id === id);
}

/** Bounding box that contains every point within maxDistanceM of any anchor. */
export function cityBBox(city: CityDefinition): CityBBox {
  const lats = city.neighbourhoods.map((n) => n.lat);
  const lngs = city.neighbourhoods.map((n) => n.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLat = city.maxDistanceM / M_PER_DEG_LAT;
  const padLng = city.maxDistanceM / (M_PER_DEG_LNG_EQ * Math.cos((midLat * Math.PI) / 180));
  return {
    south: Math.min(...lats) - padLat,
    north: Math.max(...lats) + padLat,
    west: Math.min(...lngs) - padLng,
    east: Math.max(...lngs) + padLng,
  };
}

export function cityCenter(city: CityDefinition): LatLng {
  const b = cityBBox(city);
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/**
 * Nearest neighbourhood anchor to a point, if within the city's max distance.
 * Uses an equirectangular approximation, which is accurate to well under 1% at city scale.
 */
export function neighbourhoodForPoint(city: CityDefinition, p: LatLng): Neighbourhood | undefined {
  const cosLat = Math.cos((p.lat * Math.PI) / 180);
  let best: Neighbourhood | undefined;
  let bestD2 = Infinity;
  for (const n of city.neighbourhoods) {
    const dx = (p.lng - n.lng) * M_PER_DEG_LNG_EQ * cosLat;
    const dy = (p.lat - n.lat) * M_PER_DEG_LAT;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return bestD2 <= city.maxDistanceM * city.maxDistanceM ? best : undefined;
}

export type CellPlace = { cityId: string; neighbourhoodId: string };

/** Which configured city and neighbourhood a cell belongs to, if any. */
export function placeForCell(cell: CellId): CellPlace | undefined {
  const centre = cellToLatLng(cell);
  for (const city of CITIES) {
    const b = cityBBox(city);
    if (centre.lat < b.south || centre.lat > b.north || centre.lng < b.west || centre.lng > b.east) continue;
    const n = neighbourhoodForPoint(city, centre);
    if (n) return { cityId: city.id, neighbourhoodId: n.id };
  }
  return undefined;
}

/** Exhaustively counts cells per neighbourhood. Slow (about 1 s); use getCityStats at runtime. */
export function computeCityStats(city: CityDefinition): CityStats {
  const cellsByNeighbourhood: Record<string, number> = {};
  for (const n of city.neighbourhoods) cellsByNeighbourhood[n.id] = 0;
  let totalCells = 0;
  const b = cityBBox(city);
  cellsInBBox(b.south, b.west, b.north, b.east, (_id, centre) => {
    const n = neighbourhoodForPoint(city, centre);
    if (!n) return;
    cellsByNeighbourhood[n.id] = (cellsByNeighbourhood[n.id] ?? 0) + 1;
    totalCells++;
  });
  return { totalCells, cellsByNeighbourhood };
}

/** Precomputed stats. Throws if the generated file is missing a city (run the generator). */
export function getCityStats(cityId: string): CityStats {
  const s = CITY_STATS[cityId];
  if (!s) throw new Error(`No generated stats for city ${cityId}. Run generate:city-stats.`);
  return s;
}
