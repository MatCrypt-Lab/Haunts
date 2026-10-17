import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'unfog.session';
// AFTER_FIRST_UNLOCK lets the background task read the token while the phone is locked.
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let cached: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = await SecureStore.getItemAsync(TOKEN_KEY, OPTS);
  return cached;
}

export async function setToken(token: string | null): Promise<void> {
  cached = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token, OPTS);
  else await SecureStore.deleteItemAsync(TOKEN_KEY, OPTS);
}
