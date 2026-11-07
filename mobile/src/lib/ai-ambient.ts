import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { deviceDayKey, haversineMeters, latLngToCell, type LastFix } from '@unfog/core';
import { aiApi, getAiSettings, listWishlist } from './ai';
import { on } from './events';
import { getDb, kvGet, kvGetJson, kvSet } from './local-db';

const CHANNEL = 'nudges';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Asks for notification permission. Returns whether nudges can be shown. */
export async function enableNudgePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Smart nudges', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function notify(title: string, body: string, url?: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: url ? { url } : {}, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
    trigger: null,
  });
}

/** Runs at most once per key per period. */
async function once(key: string, periodMs: number): Promise<boolean> {
  const last = Number((await kvGet(key)) ?? 0);
  if (Date.now() - last < periodMs) return false;
  await kvSet(key, String(Date.now()));
  return true;
}

/**
 * Smart nudges, checked after each batch of location fixes, also in the background.
 * Everything here runs on the phone; only the weather check asks the server, with the map block.
 */
export async function checkNudges(): Promise<void> {
  const s = await getAiSettings();
  if (!s.nudges) return;
  const last = await kvGetJson<LastFix>('last_fix');
  if (!last || Date.now() - last.t > 10 * 60_000) return;
  const today = deviceDayKey();

  // 1. A place saved to try is close by.
  for (const w of await listWishlist()) {
    if (haversineMeters(last, w) <= 150 && (await once(`nudge_wish:${w.id}:${today}`, 86_400_000))) {
      await notify(`${w.name} is right here`, 'You saved it to try. Pop in?', '/(tabs)/ask');
      break;
    }
  }

  // 2. Rain is coming. The server is asked at most every 30 minutes.
  if (await once('nudge_rain_check', 30 * 60_000)) {
    const weather = await aiApi.weather(latLngToCell(last)).catch(() => null);
    if (weather && !weather.rainingNow && weather.rainInMinutes !== null && weather.rainInMinutes <= 45 && (await once('nudge_rain_sent', 3 * 3_600_000))) {
      await notify(`Rain in about ${Math.max(5, weather.rainInMinutes)} minutes`, `${weather.rainChanceNext3h}% chance near you. Ask Haunts for a covered spot nearby.`, '/(tabs)/ask');
    }
  }

  // 3. Late at night, a long stop somewhere never visited before.
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 5) {
    const db = await getDb();
    const stay = await db.getFirstAsync<{ start_t: number; end_t: number; cell: string }>('SELECT start_t, end_t, cell FROM stays ORDER BY start_t DESC LIMIT 1');
    if (stay && Date.now() - stay.end_t < 10 * 60_000 && stay.end_t - stay.start_t >= 20 * 60_000) {
      const before = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM stays WHERE cell = ? AND start_t < ?', [stay.cell, stay.start_t]);
      if ((before?.n ?? 0) === 0 && (await once(`nudge_safety:${stay.start_t}`, 86_400_000))) {
        await notify('Long stop somewhere new', 'All good? Tap to share where you are with someone you trust.', '/safety');
      }
    }
  }
}

/**
 * Voice walking guide: when the user paints a block they have never been to, it reads a short
 * story about that corner aloud. At most once every two minutes.
 */
export function useVoiceGuide(): void {
  useEffect(() => {
    let busy = false;
    return on('cells', () => {
      void (async () => {
        if (busy || !(await getAiSettings()).voiceGuide) return;
        const last = await kvGetJson<LastFix>('last_fix');
        // 'cells' also fires after a server sync; only speak for a fresh fix.
        if (!last || Date.now() - last.t > 2 * 60_000) return;
        const cell = latLngToCell(last);
        if (!(await once('guide_spoke', 2 * 60_000))) return;
        busy = true;
        try {
          const story = await aiApi.story(cell);
          Speech.speak(`${story.title}. ${story.text}`, { language: 'en-IN' });
        } catch {
          // Quietly skip; the next new block will try again.
        } finally {
          busy = false;
        }
      })();
    });
  }, []);
}
