import type {
  AiCaption,
  AiChatBody,
  AiCoach,
  AiJournal,
  AiJournalBody,
  AiPaper,
  AiPlace,
  AiQuests,
  AiRoute,
  AiStatus,
  AiStory,
  AiToolResultsBody,
  AiTurn,
  AiWrapped,
  AiWrappedBody,
  WeatherNow,
} from '@unfog/core';
import * as Location from 'expo-location';
import { latLngToCell } from '@unfog/core';
import { api } from './api';
import { emit } from './events';
import { getDb, kvGet, kvSet, serialWrite } from './local-db';

/** Opus at high effort can take half a minute when it uses several tools. */
const SLOW = 150_000;

export const aiApi = {
  status: () => api<AiStatus>('/ai/status'),
  chat: (body: AiChatBody) => api<AiTurn>('/ai/chat', { method: 'POST', body, timeoutMs: SLOW }),
  toolResults: (body: AiToolResultsBody) => api<AiTurn>('/ai/chat/tool-results', { method: 'POST', body, timeoutMs: SLOW }),
  story: (cell: string) => api<AiStory>(`/ai/story?cell=${encodeURIComponent(cell)}`, { timeoutMs: SLOW }),
  quests: () => api<AiQuests>('/ai/quests', { timeoutMs: SLOW }),
  coach: () => api<AiCoach>('/ai/crew/coach', { timeoutMs: SLOW }),
  paper: () => api<AiPaper>('/ai/crew/paper', { timeoutMs: SLOW }),
  caption: () => api<AiCaption>('/ai/card-caption', { timeoutMs: SLOW }),
  journal: (body: AiJournalBody) => api<AiJournal>('/ai/journal', { method: 'POST', body, timeoutMs: SLOW }),
  wrapped: (body: AiWrappedBody) => api<AiWrapped>('/ai/wrapped', { method: 'POST', body, timeoutMs: SLOW }),
  weather: (cell: string) => api<WeatherNow>(`/weather?cell=${encodeURIComponent(cell)}`),
};

/** The phone's local time with its offset, which the companion needs for "now" and "tonight". */
export function localTimeIso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

/** The map block the user is in (about 60 m), never the exact position. */
export async function currentCell(): Promise<string | undefined> {
  const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (perm?.status !== 'granted') return undefined;
  const pos =
    (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null)) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
  return pos ? latLngToCell({ lat: pos.coords.latitude, lng: pos.coords.longitude }) : undefined;
}

// ---------------------------------------------------------------- settings

export type AiSettings = {
  /** null: ask the first time the companion needs the memory. */
  memoryConsent: boolean | null;
  speakReplies: boolean;
  voiceGuide: boolean;
  nudges: boolean;
};

const SETTINGS_KEY = 'ai_settings';
const DEFAULTS: AiSettings = { memoryConsent: null, speakReplies: false, voiceGuide: false, nudges: false };

export async function getAiSettings(): Promise<AiSettings> {
  try {
    return { ...DEFAULTS, ...(JSON.parse((await kvGet(SETTINGS_KEY)) ?? '{}') as Partial<AiSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export async function setAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const next = { ...(await getAiSettings()), ...patch };
  await kvSet(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------- map overlay

export type AiOverlay = { places: AiPlace[]; routes: AiRoute[]; focus: { lat: number; lng: number } | null };
let overlay: AiOverlay = { places: [], routes: [], focus: null };

export function getAiOverlay(): AiOverlay {
  return overlay;
}

/** Pins places and draws routes on the Map tab. */
export function showOnMap(places: AiPlace[], routes: AiRoute[], focus?: { lat: number; lng: number }): void {
  const first = focus ?? places[0] ?? (routes[0] ? { lng: routes[0].coordinates[0]![0], lat: routes[0].coordinates[0]![1] } : null);
  overlay = { places, routes, focus: first ?? null };
  emit('aiOverlay');
}

export function clearAiOverlay(): void {
  overlay = { places: [], routes: [], focus: null };
  emit('aiOverlay');
}

// ---------------------------------------------------------------- want to try

export type WishPlace = { id: string; name: string; category: string; lat: number; lng: number; createdAt: number };

export async function addToWishlist(p: AiPlace): Promise<void> {
  await serialWrite((db) =>
    db.runAsync('INSERT OR REPLACE INTO wishlist (id, name, category, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?)', [p.id, p.name, p.category, p.lat, p.lng, Date.now()]),
  );
}

export async function removeFromWishlist(id: string): Promise<void> {
  await serialWrite((db) => db.runAsync('DELETE FROM wishlist WHERE id = ?', [id]));
}

export async function listWishlist(): Promise<WishPlace[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; name: string; category: string; lat: number; lng: number; created_at: number }>(
    'SELECT * FROM wishlist ORDER BY created_at DESC',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, category: r.category, lat: r.lat, lng: r.lng, createdAt: r.created_at }));
}
