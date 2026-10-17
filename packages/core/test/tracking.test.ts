import { describe, expect, it } from 'vitest';
import { gridDistance, latLngToCell } from '../src/hex';
import { dayKey } from '../src/time';
import { fixesToVisits, type Fix } from '../src/tracking';
import type { PrivacyZone } from '../src/privacy';

const IST = (t: number) => dayKey(t, 330);
const T0 = Date.UTC(2026, 9, 14, 3, 0); // 08:30 IST
const fix = (lat: number, lng: number, sec: number, extra: Partial<Fix> = {}): Fix => ({
  lat,
  lng,
  accuracy: 10,
  speed: 1.4,
  timestamp: T0 + sec * 1000,
  ...extra,
});

describe('fixesToVisits', () => {
  it('paints a continuous trail between close fixes', () => {
    // About 300 m east over 4 minutes: a walk.
    const { visits, last } = fixesToVisits([fix(12.9352, 77.6245, 0), fix(12.9352, 77.6273, 240)], null, [], IST);
    expect(visits.length).toBeGreaterThan(2);
    for (let i = 1; i < visits.length; i++) expect(gridDistance(visits[i - 1]!.cell, visits[i]!.cell)).toBe(1);
    expect(visits.every((v) => v.day === '2026-10-14')).toBe(true);
    expect(last).toMatchObject({ lat: 12.9352, lng: 77.6273 });
  });

  it('continues from the last fix of the previous batch', () => {
    const first = fixesToVisits([fix(12.9352, 77.6245, 0)], null, [], IST);
    const second = fixesToVisits([fix(12.9352, 77.6273, 240)], first.last, [], IST);
    expect(second.visits.length).toBeGreaterThan(2);
  });

  it('does not connect fixes that are far apart in space or time', () => {
    const far = fixesToVisits([fix(12.9352, 77.6245, 0), fix(12.95, 77.64, 600)], null, [], IST);
    expect(far.visits).toHaveLength(2);
    const late = fixesToVisits([fix(12.9352, 77.6245, 0), fix(12.9352, 77.6273, 3600)], null, [], IST);
    expect(late.visits).toHaveLength(2);
  });

  it('drops inaccurate and too-fast fixes', () => {
    const r = fixesToVisits(
      [fix(12.9352, 77.6245, 0, { accuracy: 500 }), fix(12.9352, 77.6245, 10, { speed: 60 }), fix(12.9, 77.6, 20, { lat: NaN })],
      null,
      [],
      IST,
    );
    expect(r.visits).toHaveLength(0);
  });

  it('accepts fixes with unknown accuracy and speed', () => {
    const r = fixesToVisits([fix(12.9352, 77.6245, 0, { accuracy: null, speed: null })], null, [], IST);
    expect(r.visits).toEqual([{ cell: latLngToCell({ lat: 12.9352, lng: 77.6245 }), day: '2026-10-14' }]);
  });

  it('never records inside a privacy zone or draws a line through it', () => {
    const home: PrivacyZone = { id: 'h', label: 'Home', lat: 12.9352, lng: 77.6259, radiusM: 100 };
    // Outside points are about 300 m either side of home; the filter adds one cell of margin.
    const r = fixesToVisits([fix(12.9352, 77.623, 0), fix(12.9352, 77.6259, 120), fix(12.9352, 77.6288, 240)], null, [home], IST);
    const homeCell = latLngToCell(home);
    expect(r.visits.some((v) => v.cell === homeCell)).toBe(false);
    // Exactly the two outside fixes; no trail through home.
    expect(r.visits).toHaveLength(2);
  });

  it('splits visits across local midnight and dedupes repeats', () => {
    const beforeMidnight = Date.UTC(2026, 9, 14, 18, 29) - T0; // 23:59 IST
    const r = fixesToVisits(
      [fix(12.9352, 77.6245, beforeMidnight / 1000), fix(12.9352, 77.6245, beforeMidnight / 1000 + 30), fix(12.9352, 77.6245, beforeMidnight / 1000 + 120)],
      null,
      [],
      IST,
    );
    expect(r.visits.map((v) => v.day)).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('records a late batch without joining it to a newer fix', () => {
    const newer = { lat: 12.95, lng: 77.64, t: T0 + 600_000 };
    const r = fixesToVisits([fix(12.9352, 77.6245, 0), fix(12.9352, 77.6273, 240)], newer, [], IST);
    // The late fixes form their own trail.
    expect(r.visits.length).toBeGreaterThan(2);
    expect(r.visits.some((v) => v.cell === latLngToCell(newer))).toBe(false);
    // The newer fix stays the anchor for what comes next.
    expect(r.last).toEqual(newer);
  });

  it('keeps the previous anchor when a batch has nothing usable', () => {
    const prevFix = { lat: 12.9352, lng: 77.6245, t: T0 };
    const r = fixesToVisits([fix(12.94, 77.63, 60, { accuracy: 900 })], prevFix, [], IST);
    expect(r.visits).toHaveLength(0);
    expect(r.last).toEqual(prevFix);
  });
});
