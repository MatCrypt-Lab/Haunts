/**
 * Calendar keys as plain "YYYY-MM-DD" strings. All arithmetic is done in UTC on the
 * date itself, so results never depend on the machine's time zone.
 */

export type DayKey = string;
export type MonthKey = string;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function fromUtcDate(d: Date): DayKey {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function toUtcDate(day: DayKey): Date {
  if (!isValidDayKey(day)) throw new Error(`Invalid day key: ${day}`);
  return new Date(`${day}T00:00:00Z`);
}

export function isValidDayKey(day: unknown): day is DayKey {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && fromUtcDate(d) === day;
}

export function isValidMonthKey(month: unknown): month is MonthKey {
  return typeof month === 'string' && MONTH_RE.test(month) && isValidDayKey(`${month}-01`);
}

/** Local calendar day of an instant, for a UTC offset in minutes (IST is 330). */
export function dayKey(instant: Date | number, tzOffsetMinutes: number): DayKey {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  return fromUtcDate(new Date(ms + tzOffsetMinutes * 60_000));
}

/** Local day using the device's own time zone at that instant. */
export function deviceDayKey(instant: Date | number = Date.now()): DayKey {
  const d = typeof instant === 'number' ? new Date(instant) : instant;
  return dayKey(d, -d.getTimezoneOffset());
}

export function addDays(day: DayKey, n: number): DayKey {
  return fromUtcDate(new Date(toUtcDate(day).getTime() + n * MS_PER_DAY));
}

export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((toUtcDate(a).getTime() - toUtcDate(b).getTime()) / MS_PER_DAY);
}

/** Monday of the week containing `day`. Territory weeks run Monday to Sunday. */
export function weekStart(day: DayKey): DayKey {
  const dow = toUtcDate(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function monthKey(day: DayKey): MonthKey {
  return day.slice(0, 7);
}

/** First day of the month and first day of the following month. */
export function monthRange(month: MonthKey): { start: DayKey; endExclusive: DayKey } {
  if (!isValidMonthKey(month)) throw new Error(`Invalid month key: ${month}`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return { start: `${month}-01`, endExclusive: `${next}-01` };
}

export function previousMonth(month: MonthKey): MonthKey {
  const { start } = monthRange(month);
  return monthKey(addDays(start, -1));
}

/** Length of the run of consecutive days ending at `today` or yesterday. */
export function currentStreak(activeDays: Iterable<DayKey>, today: DayKey): number {
  const set = new Set(activeDays);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}
