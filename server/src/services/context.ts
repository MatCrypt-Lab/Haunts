import { DEFAULT_CITY_ID, dayKey, getCity } from '@unfog/core';
import type { Queryable } from '../db';
import { unauthorized } from '../errors';

export type UserContext = { userId: string; cityId: string; crewId: string | null; today: string; tzOffsetMinutes: number };

export function todayFor(cityId: string, now: Date): { today: string; tzOffsetMinutes: number } {
  const tz = getCity(cityId)?.tzOffsetMinutes ?? getCity(DEFAULT_CITY_ID)!.tzOffsetMinutes;
  return { today: dayKey(now, tz), tzOffsetMinutes: tz };
}

export async function loadContext(db: Queryable, userId: string, now: Date): Promise<UserContext> {
  const { rows } = await db.query<{ city_id: string; crew_id: string | null }>(
    'SELECT city_id, crew_id FROM users WHERE id = $1',
    [userId],
  );
  const r = rows[0];
  if (!r) throw unauthorized('Account no longer exists');
  return { userId, cityId: r.city_id, crewId: r.crew_id, ...todayFor(r.city_id, now) };
}

/** Start of a local calendar day as an instant. */
export function dayStartInstant(day: string, tzOffsetMinutes: number): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - tzOffsetMinutes * 60_000);
}
