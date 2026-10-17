import { describe, expect, it } from 'vitest';
import {
  addDays,
  currentStreak,
  dayKey,
  diffDays,
  isValidDayKey,
  isValidMonthKey,
  monthKey,
  monthRange,
  previousMonth,
  weekStart,
} from '../src/time';

describe('time keys', () => {
  it('uses the local calendar day for a UTC offset', () => {
    // 2026-10-13 19:00 UTC is 2026-10-14 00:30 in IST.
    const t = Date.UTC(2026, 9, 13, 19, 0);
    expect(dayKey(t, 0)).toBe('2026-10-13');
    expect(dayKey(t, 330)).toBe('2026-10-14');
    expect(dayKey(t, -300)).toBe('2026-10-13');
  });

  it('adds and diffs days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1);
    expect(diffDays('2026-10-01', '2026-10-14')).toBe(-13);
  });

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-14')).toBe('2026-10-12'); // Wednesday
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });

  it('computes month ranges', () => {
    expect(monthKey('2026-10-14')).toBe('2026-10');
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('validates keys strictly', () => {
    expect(isValidDayKey('2026-02-29')).toBe(false);
    expect(isValidDayKey('2028-02-29')).toBe(true);
    expect(isValidDayKey('2026-1-01')).toBe(false);
    expect(isValidMonthKey('2026-13')).toBe(false);
    expect(isValidMonthKey('2026-09')).toBe(true);
  });

  it('counts streaks ending today or yesterday', () => {
    expect(currentStreak(['2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-14')).toBe(3);
    expect(currentStreak(['2026-10-12', '2026-10-13'], '2026-10-14')).toBe(2);
    expect(currentStreak(['2026-10-11'], '2026-10-14')).toBe(0);
    expect(currentStreak([], '2026-10-14')).toBe(0);
  });
});
