import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { deviceDayKey, fixesToVisits, type LastFix } from '@unfog/core';
import { emit } from './events';
import { addVisits, kvGet, kvGetJson, kvSet, kvSetJson } from './local-db';
import { flushPending, shouldFlush } from './sync';
import { maybeRebuildStays, recordFixes } from './memory';
import { locationPipeline } from './serial';
import { getZones } from './zones';

export const LOCATION_TASK = 'unfog-background-location';

/**
 * Called by the background task and by the foreground watcher with raw fixes. Runs on the
 * shared location queue so batches never interleave and zone changes apply atomically.
 */
export async function handleLocations(locations: Location.LocationObject[]): Promise<void> {
  if (locations.length === 0) return;
  const added = await locationPipeline(async () => {
    // A batch delivered after the user paused must not be recorded.
    if (!(await isTrackingEnabled())) return 0;
    const zones = await getZones();
    const last = await kvGetJson<LastFix>('last_fix');
    const { visits, last: next, accepted } = fixesToVisits(
      locations.map((l) => ({
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        accuracy: l.coords.accuracy ?? null,
        speed: l.coords.speed !== null && l.coords.speed !== undefined && l.coords.speed >= 0 ? l.coords.speed : null,
        timestamp: l.timestamp,
      })),
      last,
      zones,
      (t) => deviceDayKey(t),
    );
    await kvSetJson('last_fix', next);
    await recordFixes(accepted);
    return visits.length > 0 ? addVisits(visits) : 0;
  });
  if (added > 0) emit('cells');
  await maybeRebuildStays().catch(() => {});
  if (await shouldFlush()) await flushPending().catch(() => {});
}

export type PermissionState = {
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
  servicesEnabled: boolean;
};

export async function getPermissionState(): Promise<PermissionState> {
  const [fg, bg, services] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return { foreground: fg.status, background: bg.status, servicesEnabled: services };
}

export async function requestForeground(): Promise<boolean> {
  const r = await Location.requestForegroundPermissionsAsync();
  return r.status === 'granted';
}

/** On Android 11+ this opens system settings where the user must pick "Allow all the time". */
export async function requestBackground(): Promise<boolean> {
  const r = await Location.requestBackgroundPermissionsAsync();
  return r.status === 'granted';
}

export async function isTrackingEnabled(): Promise<boolean> {
  return (await kvGet('tracking_enabled')) !== '0';
}

export async function isTrackingRunning(): Promise<boolean> {
  if (!(await TaskManager.isAvailableAsync())) return false;
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

/**
 * High accuracy keeps background fixes inside the 100 m accuracy filter, so blocks are
 * right. The distance filter and deferred delivery keep the GPS from running constantly.
 * If the battery test (docs/QA_TEST_PLAN.md, section 8) shows over 8% a day, try
 * Accuracy.Balanced with TRACKING.maxAccuracyM raised to 150 in packages/core.
 */
const BACKGROUND_ACCURACY = Location.Accuracy.High;

/**
 * Starts, or restarts, background updates if the user wants tracking and has granted
 * permission. Call it only while the app is in the foreground: Android 14 refuses to start
 * a location foreground service from the background. Calling it again is safe and is what
 * brings the foreground service back after a reboot or an app update, when Android restores
 * the task without its service.
 */
export async function startTracking(): Promise<'running' | 'disabled' | 'no_permission' | 'unavailable'> {
  if (!(await isTrackingEnabled())) return 'disabled';
  if (!(await TaskManager.isAvailableAsync())) return 'unavailable';
  const perms = await getPermissionState();
  if (perms.foreground !== 'granted' || perms.background !== 'granted') return 'no_permission';
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: BACKGROUND_ACCURACY,
    distanceInterval: 40,
    timeInterval: 30_000,
    deferredUpdatesDistance: 150,
    deferredUpdatesInterval: 2 * 60_000,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'Haunts is revealing your map',
      notificationBody: 'Private zones are never recorded. Pause anytime in the app.',
      notificationColor: '#00C2FF',
      killServiceOnDestroy: false,
    },
  });
  return 'running';
}

export async function stopTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Task was never registered on this install.
  }
}

export async function setTrackingEnabled(enabled: boolean): Promise<void> {
  await locationPipeline(async () => {
    await kvSet('tracking_enabled', enabled ? '1' : '0');
    // Do not draw a line from where tracking paused to where it resumes.
    if (!enabled) await kvSetJson('last_fix', null);
  });
  if (enabled) await startTracking();
  else await stopTracking();
}

/** Precise, frequent updates while the map is open so the reveal feels live. */
export async function watchForeground(): Promise<Location.LocationSubscription | null> {
  if ((await Location.getForegroundPermissionsAsync()).status !== 'granted') return null;
  if (!(await isTrackingEnabled())) return null;
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: Platform.OS === 'android' ? 5000 : undefined },
    (loc) => void handleLocations([loc]),
  );
}
