import { describe, expect, it } from 'vitest';
import { latLngToCell } from '../src/hex';
import {
  BENGALURU_FOR_TEST,
  CITIES,
  computeCityStats,
  getCity,
  getCityStats,
  neighbourhoodForPoint,
  placeForCell,
} from './helpers';

describe('cities', () => {
  it('has unique neighbourhood ids and names', () => {
    for (const city of CITIES) {
      const ids = city.neighbourhoods.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      const names = city.neighbourhoods.map((n) => n.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('maps every anchor to its own neighbourhood', () => {
    for (const n of BENGALURU_FOR_TEST.neighbourhoods) {
      expect(neighbourhoodForPoint(BENGALURU_FOR_TEST, n)?.id).toBe(n.id);
    }
  });

  it('places a Koramangala cell in Bengaluru and rejects a far-away cell', () => {
    expect(placeForCell(latLngToCell({ lat: 12.9352, lng: 77.6245 }))).toEqual({
      cityId: 'blr',
      neighbourhoodId: 'koramangala',
    });
    expect(placeForCell(latLngToCell({ lat: 19.076, lng: 72.8777 }))).toBeUndefined();
    // Inside the bounding box but far from any anchor (Bannerghatta forest edge).
    expect(placeForCell(latLngToCell({ lat: 12.81, lng: 77.5 }))).toBeUndefined();
  });

  it('keeps the generated stats file in sync with the city definitions', () => {
    for (const city of CITIES) {
      expect(getCityStats(city.id)).toEqual(computeCityStats(city));
    }
  });

  it('gives every neighbourhood a positive cell count that sums to the total', () => {
    const s = getCityStats('blr');
    const sum = Object.values(s.cellsByNeighbourhood).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totalCells);
    for (const n of BENGALURU_FOR_TEST.neighbourhoods) expect(s.cellsByNeighbourhood[n.id]).toBeGreaterThan(50);
  });

  it('looks cities up by id', () => {
    expect(getCity('blr')?.name).toBe('Bengaluru');
    expect(getCity('nope')).toBeUndefined();
    expect(() => getCityStats('nope')).toThrow();
  });
});
