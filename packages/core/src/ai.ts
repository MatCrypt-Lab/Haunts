import { z } from 'zod';
import { cellSchema, daySchema, monthSchema } from './contracts';

// ---------------------------------------------------------------- shared shapes

/** A real place from OpenStreetMap, found by the companion. */
export type AiPlace = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  distanceM: number;
  address: string | null;
  openingHours: string | null;
  /** Useful OSM tags such as cuisine, wifi, outdoor_seating, website. */
  details: Record<string, string>;
};

export type AiRoute = {
  id: string;
  title: string;
  distanceM: number;
  durationMin: number;
  /** [lng, lat] pairs, simplified. */
  coordinates: [number, number][];
  /** Explore walks only: blocks on the route the user has never painted. */
  newBlocks?: number;
  /** Explore walks only: hidden drops the route passes. */
  dropsOnRoute?: number;
};

export type AiItineraryStop = { time: string; placeId: string; title: string; note: string };

export type AiReply = {
  message: string;
  placeIds: string[];
  routeIds: string[];
  itinerary: AiItineraryStop[];
  suggestions: string[];
};

/**
 * Tools the agent runs on the phone, because they read private memory that never leaves it.
 * Each returns a small summary, never the timeline itself.
 */
export const PHONE_TOOLS = ['check_visited', 'memory_query', 'taste_profile', 'saved_places'] as const;
export type PhoneToolName = (typeof PHONE_TOOLS)[number];

export type AiPhoneCall = { id: string; name: PhoneToolName; input: Record<string, unknown> };

/** One companion turn. Either a reply, or phone tools to run and send back. */
export type AiTurn = {
  reply: AiReply | null;
  places: AiPlace[];
  routes: AiRoute[];
  pending: AiPhoneCall[];
  /** Signed conversation state. Send it back unchanged with the next message. */
  state: string;
};

export type AiStatus = { enabled: boolean; model: string | null };

export type AiStory = { cell: string; title: string; text: string };

export type AiQuest = {
  id: string;
  kind: 'new_blocks' | 'neighbourhood' | 'drop';
  title: string;
  description: string;
  target: number;
  progress: number;
  done: boolean;
  neighbourhoodId: string | null;
};
export type AiQuests = { day: string; quests: AiQuest[] };

export type AiCoach = { text: string; generatedAt: string };
export type AiPaper = { week: string; headline: string; stories: { title: string; body: string }[]; generatedAt: string };
export type AiCaption = { caption: string };
export type AiJournal = { title: string; text: string };
export type AiWrapped = { title: string; text: string; highlights: string[] };

export type WeatherNow = {
  tempC: number;
  condition: string;
  rainingNow: boolean;
  /** Highest chance of rain in the next three hours, 0-100. */
  rainChanceNext3h: number;
  /** Minutes until the first hour with a 60%+ chance of rain, or null. */
  rainInMinutes: number | null;
};

// ---------------------------------------------------------------- request bodies

/** ISO time with the phone's offset, e.g. 2026-11-07T19:30:00+05:30. */
const localTimeSchema = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

export const aiChatBody = z.object({
  message: z.string().trim().min(1).max(2000),
  /** Current map block (about 60 m). Never exact coordinates. */
  cell: cellSchema.optional(),
  localTime: localTimeSchema,
  image: z
    .object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().max(6_000_000) })
    .optional(),
  state: z.string().max(6_000_000).optional(),
});
export type AiChatBody = z.infer<typeof aiChatBody>;

export const aiToolResultsBody = z.object({
  state: z.string().min(1).max(6_000_000),
  results: z
    .array(z.object({ id: z.string().max(100), output: z.string().max(12_000), isError: z.boolean().optional() }))
    .min(1)
    .max(10),
});
export type AiToolResultsBody = z.infer<typeof aiToolResultsBody>;

export const aiCellQuery = z.object({ cell: cellSchema });

const shortText = z.string().trim().min(1).max(120);

export const aiJournalBody = z.object({
  day: daySchema,
  stops: z
    .array(z.object({ name: shortText, start: z.string().max(10), end: z.string().max(10), minutes: z.number().int().min(0).max(1440) }))
    .max(40),
  walkedKm: z.number().min(0).max(200).optional(),
  newBlocks: z.number().int().min(0).max(10_000).optional(),
});
export type AiJournalBody = z.infer<typeof aiJournalBody>;

export const aiWrappedBody = z.object({
  month: monthSchema,
  days: z.number().int().min(0).max(31),
  stops: z.number().int().min(0).max(5000),
  newPlaces: z.number().int().min(0).max(5000),
  topPlaces: z.array(z.object({ name: shortText, visits: z.number().int().min(0), minutes: z.number().int().min(0) })).max(10),
  topAreas: z.array(z.object({ name: shortText, minutes: z.number().int().min(0) })).max(10),
});
export type AiWrappedBody = z.infer<typeof aiWrappedBody>;

export const aiQuestIdeasBody = z.object({
  brief: z.string().trim().min(3).max(1000),
  neighbourhoodId: z.string().max(60).optional(),
  count: z.number().int().min(1).max(10).default(5),
});
