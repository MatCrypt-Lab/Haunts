import { deviceDayKey, addDays } from '@unfog/core';

export function timeOfDay(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "Today", "Yesterday", or "Mon, 13 Oct" (with the year when it is not this year). */
export function dayLabel(day: string): string {
  const today = deviceDayKey();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${day}T00:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export function dateLabel(t: number): string {
  return dayLabel(deviceDayKey(t));
}
