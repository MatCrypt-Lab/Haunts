import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'http://localhost:8080').replace(/\/+$/, '');

/** OpenFreeMap: free vector tiles, no API key. https://openfreemap.org */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
