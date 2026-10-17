import { CELL_SIZE_M, cellToLatLng, haversineMeters, type CellId, type LatLng } from './hex';

/** A circle the app never records inside, such as home or work. Stored only on the device. */
export type PrivacyZone = { id: string; label: string; lat: number; lng: number; radiusM: number };

export const PRIVACY_RADIUS_OPTIONS_M = [200, 400, 800] as const;
export const DEFAULT_PRIVACY_RADIUS_M = 400;

export function pointInZones(p: LatLng, zones: readonly PrivacyZone[]): boolean {
  return zones.some((z) => haversineMeters(p, z) <= z.radiusM);
}

/** True if any part of the cell could overlap a zone (centre distance minus cell radius). */
export function cellInZones(cell: CellId, zones: readonly PrivacyZone[]): boolean {
  if (zones.length === 0) return false;
  const c = cellToLatLng(cell);
  return zones.some((z) => haversineMeters(c, z) <= z.radiusM + CELL_SIZE_M);
}

export function filterCellsOutsideZones(cells: readonly CellId[], zones: readonly PrivacyZone[]): CellId[] {
  return zones.length === 0 ? [...cells] : cells.filter((c) => !cellInZones(c, zones));
}
