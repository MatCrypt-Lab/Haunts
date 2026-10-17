import { cellBoundary, cellToLatLng, type CrewMapCell } from '@unfog/core';
import type { FeatureCollection, Point, Polygon } from 'geojson';

export const WORLD_FOG: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
      },
    },
  ],
};

export function cellsToGeoJSON(cells: readonly string[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [cellBoundary(cell)] },
    })),
  };
}

export function crewCellsToGeoJSON(cells: readonly CrewMapCell[]): FeatureCollection<Polygon, { m: number }> {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      properties: { m: c.members },
      geometry: { type: 'Polygon', coordinates: [cellBoundary(c.cell)] },
    })),
  };
}

export function pointsToGeoJSON<P extends Record<string, unknown>>(
  points: readonly (P & { lat: number; lng: number })[],
): FeatureCollection<Point, P> {
  return {
    type: 'FeatureCollection',
    features: points.map(({ lat, lng, ...props }) => ({
      type: 'Feature',
      properties: props as unknown as P,
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })),
  };
}

export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** [west, south, east, north], as MapLibre reports viewport bounds. */
export type Bounds = [number, number, number, number];

/** Zoom at which blocks are drawn as hexagons. Below it they are drawn as light points. */
export const DETAIL_ZOOM = 12.5;
/** Most hexagons sent to the map at once, to keep updates fast on low-end phones. */
export const MAX_POLYGONS = 12_000;

/** Pads bounds by a fraction of their size on every side, so small pans need no update. */
export function padBounds([w, s, e, n]: Bounds, frac = 0.5): Bounds {
  const dx = (e - w) * frac;
  const dy = (n - s) * frac;
  return [w - dx, s - dy, e + dx, n + dy];
}

/** Items whose cell centre falls inside the bounds, up to `limit`. */
export function inBounds<T>(items: readonly T[], cellOf: (t: T) => string, b: Bounds, limit = MAX_POLYGONS): T[] {
  const [w, s, e, n] = b;
  const out: T[] = [];
  for (const it of items) {
    const p = cellToLatLng(cellOf(it));
    if (p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n) {
      out.push(it);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function cellsToPoints<P extends Record<string, unknown>>(
  items: readonly { cell: string; props?: P }[],
): FeatureCollection<Point, P | Record<string, never>> {
  return {
    type: 'FeatureCollection',
    features: items.map(({ cell, props }) => {
      const p = cellToLatLng(cell);
      return { type: 'Feature', properties: props ?? {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } };
    }),
  };
}
