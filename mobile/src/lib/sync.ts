import { addDays, cellInZones, deviceDayKey, LIMITS, type FoundDrop, type NewTitle, type VisitsResult } from '@unfog/core';
import { ApiError, api } from './api';
import { emit } from './events';
import { countPending, deletePending, deletePendingBefore, kvGet, kvSet, kvUpdateJson, mergeServerCells, peekPending } from './local-db';
import { getToken } from './secure';
import { getZones, queueForget, retryForget } from './zones';

const BATCH = 1000;
const FLUSH_EVERY_MS = 10 * 60_000;
const FLUSH_AT_PENDING = 40;
const REWARDS_KEY = 'unseen_rewards';

type Rewards = { drops: FoundDrop[]; titles: NewTitle[] };

let inflight: Promise<void> | null = null;
let again = false;

/**
 * Uploads queued visits. Safe to call from the background task and the UI at the same time.
 * A call made while an upload is running schedules one more pass, so nothing queued after
 * the running pass started is left behind.
 */
export function flushPending(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      do {
        again = false;
        await doFlush();
      } while (again);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function doFlush(): Promise<void> {
  if (!(await getToken())) return;
  // The server ignores visits older than this, so stop retrying them.
  await deletePendingBefore(addDays(deviceDayKey(), -LIMITS.visitMaxAgeDays));
  const rewards: Rewards = { drops: [], titles: [] };
  for (let guard = 0; guard < 50; guard++) {
    const batch = await peekPending(BATCH);
    if (batch.length === 0) break;
    try {
      const r = await api<VisitsResult>('/visits', { method: 'POST', body: { visits: batch } });
      rewards.drops.push(...r.foundDrops);
      rewards.titles.push(...r.newTitles);
    } catch (err) {
      // A 400 means the batch itself is bad; drop it so it cannot block the queue forever.
      if (err instanceof ApiError && err.status === 400) {
        await deletePending(batch);
        continue;
      }
      throw err;
    }
    await deletePending(batch);
  }
  await kvSet('last_upload', String(Date.now()));
  await retryForget().catch(() => {});
  if (rewards.drops.length || rewards.titles.length) {
    // Kept until the UI shows them, in case this ran in the background.
    await kvUpdateJson<Rewards>(REWARDS_KEY, (cur) => ({
      drops: [...(cur?.drops ?? []), ...rewards.drops],
      titles: [...(cur?.titles ?? []), ...rewards.titles],
    }));
    emit('rewards', rewards);
  }
}

export async function shouldFlush(): Promise<boolean> {
  const pending = await countPending();
  if (pending >= FLUSH_AT_PENDING) return true;
  const last = Number((await kvGet('last_upload')) ?? 0);
  return pending > 0 && Date.now() - last > FLUSH_EVERY_MS;
}

/** Rewards found while the app was in the background. Taken atomically, so each shows once. */
export async function takeUnseenRewards(): Promise<Rewards | null> {
  const taken = await kvUpdateJson<Rewards>(REWARDS_KEY, () => null);
  if (!taken || (taken.drops.length === 0 && taken.titles.length === 0)) return null;
  return taken;
}

/**
 * Pulls the server's copy of this user's cells (for a new phone or reinstall). Cells inside
 * this phone's private zones are not stored and are queued to be erased on the server.
 */
export async function pullCells(): Promise<number> {
  const r = await api<{ cells: [string, string][] }>('/me/cells');
  const zones = await getZones();
  const keep: [string, string][] = [];
  const forget: string[] = [];
  for (const pair of r.cells) {
    if (zones.length && cellInZones(pair[0], zones)) forget.push(pair[0]);
    else keep.push(pair);
  }
  const added = await mergeServerCells(keep);
  if (forget.length) {
    await queueForget(forget);
    void retryForget().catch(() => {});
  }
  if (added > 0) emit('cells');
  return added;
}
