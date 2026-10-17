import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { LOCATION_TASK, handleLocations } from './tracking';

// Defined at module scope and imported from index.ts before the router, as TaskManager requires.
TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    await handleLocations(data.locations);
  } catch {
    // Never throw from a background task; the next batch will try again.
  }
});
