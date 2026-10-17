import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE_M,
  cellBoundary,
  cellDisk,
  cellNeighbours,
  cellToLatLng,
  cellsAlongSegment,
  gridDistance,
  haversineMeters,
  idToAxial,
  isValidCellId,
  latLngToCell,
} from '../src/hex';

const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };

describe('hex grid', () => {
  it('round-trips a point to a cell whose centre is within one cell radius', () => {
    for (let i = 0; i < 2000; i++) {
      const p = { lat: 12.8 + Math.random() * 0.4, lng: 77.4 + Math.random() * 0.4 };
      const c = cellToLatLng(latLngToCell(p));
      // Ground radius is CELL_SIZE_M * cos(lat), always <= CELL_SIZE_M.
      expect(haversineMeters(p, c)).toBeLessThanOrEqual(CELL_SIZE_M + 0.5);
    }
  });

  it('maps a cell centre back to the same cell', () => {
    const id = latLngToCell(KORAMANGALA);
    expect(latLngToCell(cellToLatLng(id))).toBe(id);
  });

  it('produces valid, stable ids without negative zero', () => {
    const id = latLngToCell({ lat: 0.0001, lng: -0.0001 });
    expect(isValidCellId(id)).toBe(true);
    expect(id.includes('-0_')).toBe(false);
    expect(isValidCellId('1_2')).toBe(true);
    expect(isValidCellId('-12_345')).toBe(true);
    expect(isValidCellId('1-2')).toBe(false);
    expect(isValidCellId('12345678_1')).toBe(false);
    expect(isValidCellId(42)).toBe(false);
    expect(() => idToAxial('nope')).toThrow();
  });

  it('works in the southern and western hemispheres', () => {
    const p = { lat: -33.8688, lng: 151.2093 };
    expect(haversineMeters(p, cellToLatLng(latLngToCell(p)))).toBeLessThan(CELL_SIZE_M);
    const q = { lat: 40.7128, lng: -74.006 };
    expect(haversineMeters(q, cellToLatLng(latLngToCell(q)))).toBeLessThan(CELL_SIZE_M);
  });

  it('has six distinct neighbours at distance one', () => {
    const id = latLngToCell(KORAMANGALA);
    const ns = cellNeighbours(id);
    expect(new Set(ns).size).toBe(6);
    for (const n of ns) expect(gridDistance(id, n)).toBe(1);
  });

  it('builds a disk of 1 + 3k(k+1) cells', () => {
    const id = latLngToCell(KORAMANGALA);
    expect(cellDisk(id, 0)).toEqual([id]);
    expect(cellDisk(id, 1)).toHaveLength(7);
    expect(cellDisk(id, 3)).toHaveLength(37);
    for (const c of cellDisk(id, 3)) expect(gridDistance(id, c)).toBeLessThanOrEqual(3);
  });

  it('returns a closed hexagon ring in [lng, lat] order', () => {
    const ring = cellBoundary(latLngToCell(KORAMANGALA));
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    const centre = cellToLatLng(latLngToCell(KORAMANGALA));
    for (const [lng, lat] of ring.slice(0, 6)) {
      const d = haversineMeters(centre, { lat, lng });
      expect(d).toBeGreaterThan(CELL_SIZE_M * 0.9);
      expect(d).toBeLessThan(CELL_SIZE_M * 1.01);
    }
  });

  it('fills a segment with a contiguous chain of cells', () => {
    const a = KORAMANGALA;
    const b = { lat: 12.9395, lng: 77.6301 }; // roughly 750 m away
    const cells = cellsAlongSegment(a, b);
    expect(cells[0]).toBe(latLngToCell(a));
    expect(cells.at(-1)).toBe(latLngToCell(b));
    for (let i = 1; i < cells.length; i++) expect(gridDistance(cells[i - 1]!, cells[i]!)).toBe(1);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('returns a single cell for a zero-length segment', () => {
    expect(cellsAlongSegment(KORAMANGALA, KORAMANGALA)).toEqual([latLngToCell(KORAMANGALA)]);
  });
});
