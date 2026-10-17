import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../src/hex';
import {
  decodePolyline,
  detectStays,
  encodePolyline,
  formatDuration,
  matchPlace,
  simplifyPath,
  splitSegments,
  type TimedPoint,
} from '../src/memory';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 14, 3, 0);
const HOME = { lat: 12.9352, lng: 77.6245 };
const CAFE = { lat: 12.9719, lng: 77.6412 }; // about 4.4 km away
const at = (p: { lat: number; lng: number }, minutes: number, dLat = 0): TimedPoint => ({ lat: p.lat + dLat, lng: p.lng, t: T0 + minutes * MIN });

describe('detectStays', () => {
  it('turns a single fix followed by a long silence into a stay that ends when you left', () => {
    // Arrive at the cafe, phone goes quiet, next fix is 500 m away 62 minutes later.
    const away = { lat: CAFE.lat + 0.0045, lng: CAFE.lng }; // ~500 m north
    const stays = detectStays([at(CAFE, 0), at(away, 62)]);
    expect(stays).toHaveLength(1);
    const s = stays[0]!;
    expect(s.start).toBe(T0);
    // 500 m at 1.4 m/s is about 6 minutes of walking, so the stay ends around minute 56.
    expect((s.end - s.start) / MIN).toBeGreaterThan(54);
    expect((s.end - s.start) / MIN).toBeLessThan(58);
    expect(haversineMeters(s, CAFE)).toBeLessThan(5);
  });

  it('merges jittery fixes around one spot and ignores short pauses', () => {
    const pts = [at(HOME, 0), at(HOME, 10, 0.0003), at(HOME, 20, -0.0002), at(CAFE, 60)];
    const stays = detectStays(pts);
    expect(stays).toHaveLength(1);
    expect(haversineMeters(stays[0]!, HOME)).toBeLessThan(40);

    const pause = detectStays([at(HOME, 0), at(HOME, 2), at(CAFE, 3)]);
    expect(pause).toHaveLength(0);
  });

  it('does not invent a stay across a silence longer than 12 hours', () => {
    const stays = detectStays([at(HOME, 0), at(CAFE, 20 * 60)]);
    expect(stays).toHaveLength(0);
  });

  it('finds several stops in a day, in order', () => {
    const pts = [at(HOME, 0), at(HOME, 30), at(CAFE, 90), at(CAFE, 150), at(HOME, 240)];
    const stays = detectStays(pts);
    expect(stays.map((s) => Math.round(haversineMeters(s, CAFE) / 1000))).toEqual([4, 0]);
    expect(stays[0]!.end).toBeLessThanOrEqual(stays[1]!.start);
  });
});

describe('places and paths', () => {
  it('matches a stop to the nearest saved place within range', () => {
    const places = [
      { id: 'home', name: 'Home', ...HOME },
      { id: 'cafe', name: 'Cafe', ...CAFE },
    ];
    expect(matchPlace({ lat: HOME.lat + 0.0004, lng: HOME.lng }, places)?.id).toBe('home');
    expect(matchPlace({ lat: HOME.lat + 0.002, lng: HOME.lng }, places)).toBeUndefined();
  });

  it('round-trips polylines to about a metre', () => {
    const pts = [HOME, { lat: 12.93605, lng: 77.62601 }, { lat: -33.86882, lng: 151.20929 }];
    const back = decodePolyline(encodePolyline(pts));
    expect(back).toHaveLength(3);
    back.forEach((p, i) => expect(haversineMeters(p, pts[i]!)).toBeLessThan(1.5));
    expect(encodePolyline([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }])).toBe(
      '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    );
    expect(() => decodePolyline('_p~iF~ps|U_')).toThrow();
  });

  it('simplifies a straight walk to its ends and keeps corners', () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ lat: 12.93 + i * 0.0001, lng: 77.62 }));
    expect(simplifyPath(straight)).toHaveLength(2);
    const corner = [...straight, ...Array.from({ length: 50 }, (_, i) => ({ lat: 12.9349, lng: 77.62 + (i + 1) * 0.0001 }))];
    expect(simplifyPath(corner).length).toBe(3);
  });

  it('splits a day into segments at silences and jumps', () => {
    const pts = [at(HOME, 0), at(HOME, 1, 0.0005), at(HOME, 60, 0.001), at(HOME, 61, 0.0015), at(CAFE, 62), at(CAFE, 63, 0.0005)];
    const segs = splitSegments(pts);
    expect(segs.map((s) => s.length)).toEqual([2, 2, 2]);
  });

  it('formats durations', () => {
    expect(formatDuration(3 * MIN)).toBe('under 5m');
    expect(formatDuration(45 * MIN)).toBe('45m');
    expect(formatDuration(120 * MIN)).toBe('2h');
    expect(formatDuration(135 * MIN)).toBe('2h 15m');
  });
});
