import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Me } from '@unfog/core';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api';
import { on } from './events';
import { clearLocalData, kvGet, kvGetJson, kvSet, kvSetJson } from './local-db';
import { getToken, setToken } from './secure';
import { backupNow } from './memory';
import { flushPending } from './sync';
import { stopTracking } from './tracking';

type AuthState =
  | { status: 'loading'; me: null; onboarded: false }
  | { status: 'signedOut'; me: null; onboarded: false }
  | { status: 'signedIn'; me: Me; onboarded: boolean };

/**
 * - `user`: the person tapped Sign out. Pending visits are uploaded first, then everything
 *   on the phone is wiped.
 * - `expired`: the server rejected the session. Local data is kept so nothing recorded is
 *   lost if the same person signs back in.
 * - `deleted`: the account no longer exists. Everything on the phone is wiped.
 */
export type SignOutReason = 'user' | 'expired' | 'deleted';

type AuthContextValue = AuthState & {
  completeSignIn: (token: string, me: Me) => Promise<void>;
  setMe: (me: Me) => void;
  /** Marks this install as onboarded (permissions and privacy zones are per device). */
  markOnboarded: () => Promise<void>;
  refreshMe: () => Promise<void>;
  signOut: (reason?: SignOutReason) => Promise<void>;
};

const OWNER_KEY = 'owner_user_id';
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', me: null, onboarded: false });
  const queryClient = useQueryClient();

  /** Ignored unless signed in, so a late response cannot revive a signed-out session. */
  const setMe = useCallback((me: Me) => {
    setState((prev) => (prev.status === 'signedIn' ? { ...prev, me } : prev));
    void kvSetJson('me', me);
  }, []);

  const markOnboarded = useCallback(async () => {
    await kvSet('onboarded', '1');
    setState((prev) => (prev.status === 'signedIn' ? { ...prev, onboarded: true } : prev));
  }, []);

  const signOut = useCallback(
    async (reason: SignOutReason = 'user') => {
      if (reason === 'user') {
        await flushPending().catch(() => {});
        // The private memory is wiped from this phone below; save it first if backup is on.
        await backupNow().catch(() => {});
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
      }
      await stopTracking();
      await setToken(null);
      if (reason !== 'expired') await clearLocalData().catch(() => {});
      queryClient.clear();
      setState({ status: 'signedOut', me: null, onboarded: false });
    },
    [queryClient],
  );

  const refreshMe = useCallback(async () => {
    setMe(await api<Me>('/me'));
  }, [setMe]);

  // Restore the session. If storage is unreadable (for example an iPhone relaunched in the
  // background before its first unlock), try again when the app becomes active.
  useEffect(() => {
    let done = false;
    let running = false;
    const load = async () => {
      if (done || running) return;
      running = true;
      try {
        const token = await getToken();
        if (!token) {
          done = true;
          setState({ status: 'signedOut', me: null, onboarded: false });
          return;
        }
        const onboarded = (await kvGet('onboarded')) === '1';
        try {
          const me = await api<Me>('/me');
          done = true;
          setState({ status: 'signedIn', me, onboarded: onboarded && me.username !== null });
          void kvSetJson('me', me);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            done = true;
            await signOut('expired');
            return;
          }
          // Offline or server down: stay signed in with the last known profile.
          const cached = await kvGetJson<Me>('me');
          done = true;
          setState(cached ? { status: 'signedIn', me: cached, onboarded } : { status: 'signedOut', me: null, onboarded: false });
        }
      } catch {
        // Storage not readable yet; the AppState listener retries.
      } finally {
        running = false;
      }
    };
    void load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void load());
    return () => sub.remove();
  }, [signOut]);

  useEffect(() => on('unauthorized', () => void signOut('expired')), [signOut]);

  const completeSignIn = useCallback(
    async (token: string, me: Me) => {
      // Keep this phone's map, queue, zones and onboarding only for the same person.
      const sameUser = (await kvGet(OWNER_KEY)) === me.id;
      if (!sameUser) {
        await clearLocalData();
        await kvSet(OWNER_KEY, me.id);
      }
      const onboarded = sameUser && (await kvGet('onboarded')) === '1' && me.username !== null;
      await setToken(token);
      queryClient.clear();
      setState({ status: 'signedIn', me, onboarded });
      void kvSetJson('me', me);
      if (sameUser) void flushPending().catch(() => {});
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, completeSignIn, setMe, markOnboarded, refreshMe, signOut }),
    [state, completeSignIn, setMe, markOnboarded, refreshMe, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useMe(): Me {
  const a = useAuth();
  if (a.status !== 'signedIn') throw new Error('useMe used while signed out');
  return a.me;
}
