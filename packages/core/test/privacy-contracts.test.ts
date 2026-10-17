import { describe, expect, it } from 'vitest';
import { cellDisk, latLngToCell } from '../src/hex';
import { cellInZones, filterCellsOutsideZones, pointInZones, type PrivacyZone } from '../src/privacy';
import { adminChallengeBody, emailSchema, profilePatchBody, usernameSchema, visitsBody } from '../src/contracts';

const home: PrivacyZone = { id: 'home', label: 'Home', lat: 12.9352, lng: 77.6245, radiusM: 400 };

describe('privacy zones', () => {
  it('drops every cell near home and keeps distant ones', () => {
    const centre = latLngToCell(home);
    const disk = cellDisk(centre, 12);
    const kept = filterCellsOutsideZones(disk, [home]);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(disk.length);
    expect(kept).not.toContain(centre);
    expect(cellInZones(centre, [home])).toBe(true);
    expect(pointInZones({ lat: 12.9352, lng: 77.6245 }, [home])).toBe(true);
    expect(pointInZones({ lat: 12.97, lng: 77.64 }, [home])).toBe(false);
  });

  it('is a no-op with no zones', () => {
    expect(filterCellsOutsideZones(['1_2'], [])).toEqual(['1_2']);
  });
});

describe('contracts', () => {
  it('normalises emails and usernames', () => {
    expect(emailSchema.parse('  Foo@Example.COM ')).toBe('foo@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(usernameSchema.parse('Priya.K')).toBe('priya.k');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('has space').success).toBe(false);
  });

  it('rejects empty profile patches and bad visits', () => {
    expect(profilePatchBody.safeParse({}).success).toBe(false);
    expect(visitsBody.safeParse({ visits: [{ cell: '1_2', day: '2026-10-14' }] }).success).toBe(true);
    expect(visitsBody.safeParse({ visits: [{ cell: 'x', day: '2026-10-14' }] }).success).toBe(false);
    expect(visitsBody.safeParse({ visits: [] }).success).toBe(false);
  });

  it('requires a challenge to end on or after it starts', () => {
    const base = { name: 'City Wars', cityId: 'blr', teams: [{ name: 'A team', color: '#FF5A5F' }, { name: 'B team', color: '#3DDC97' }] };
    expect(adminChallengeBody.safeParse({ ...base, startsOn: '2026-10-01', endsOn: '2026-10-30' }).success).toBe(true);
    expect(adminChallengeBody.safeParse({ ...base, startsOn: '2026-10-30', endsOn: '2026-10-01' }).success).toBe(false);
  });
});
