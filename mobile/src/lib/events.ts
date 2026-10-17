import type { FoundDrop, NewTitle } from '@unfog/core';

type Events = {
  /** Local cells changed (new visits recorded or server sync). */
  cells: void;
  /** Upload finished and the server reported something worth celebrating. */
  rewards: { drops: FoundDrop[]; titles: NewTitle[] };
  /** The private memory changed (places saved, restored, deleted). */
  memory: void;
  /** Server rejected the session. */
  unauthorized: void;
};

type Listener<T> = (payload: T) => void;
const listeners = new Map<keyof Events, Set<Listener<unknown>>>();

export function on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  const l = fn as Listener<unknown>;
  set.add(l);
  return () => {
    set.delete(l);
  };
}

export function emit<K extends keyof Events>(event: K, ...payload: Events[K] extends void ? [] : [Events[K]]): void {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload[0]);
    } catch {
      // A broken listener must never break tracking.
    }
  });
}
