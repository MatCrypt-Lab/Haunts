/** Crew colours. Chosen to stay readable on the dark map and on the story card. */
export const CREW_COLORS = [
  '#FF5A5F',
  '#FF9F1C',
  '#FFD23F',
  '#3DDC97',
  '#00C2FF',
  '#4D7CFE',
  '#9B5DE5',
  '#F15BB5',
  '#C6FF00',
  '#FFFFFF',
] as const;

export const DEFAULT_SOLO_COLOR = '#00C2FF';

export const LIMITS = {
  crewMaxMembers: 20,
  visitsPerRequest: 2000,
  /** Visits older than this many days are rejected; the phone queue holds a week offline. */
  visitMaxAgeDays: 7,
  /** A single person cannot plausibly reveal more than this many cells in one day. */
  maxCellsPerDay: 3000,
  communityDropsPerWeek: 3,
  dropReportsToHide: 3,
  /** Share of a neighbourhood's cells you must explore to become its Pioneer. */
  pioneerFraction: 0.25,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpMaxSendsPerHour: 5,
  sessionTtlDays: 90,
} as const;

/** Tracking rules applied on the phone before anything is stored. */
export const TRACKING = {
  maxAccuracyM: 100,
  /** Interpolate between fixes only when they are this close in space and time. */
  maxGapM: 400,
  maxGapMs: 15 * 60_000,
  /** Ignore fixes faster than this (flights, glitches). 35 m/s is about 126 km/h. */
  maxSpeedMps: 35,
} as const;
