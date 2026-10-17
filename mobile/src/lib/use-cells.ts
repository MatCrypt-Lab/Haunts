import { useEffect, useState } from 'react';
import { on } from './events';
import { getAllCells } from './local-db';

/** The user's revealed cells from the on-device store, refreshed whenever new ones land. */
export function useLocalCells(): { cells: string[]; ready: boolean } {
  const [cells, setCells] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      getAllCells()
        .then((c) => {
          if (alive) {
            setCells(c);
            setReady(true);
          }
        })
        .catch(() => alive && setReady(true));
    void load();
    // Coalesce bursts of updates from the foreground watcher.
    const off = on('cells', () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load();
      }, 800);
    });
    return () => {
      alive = false;
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return { cells, ready };
}
