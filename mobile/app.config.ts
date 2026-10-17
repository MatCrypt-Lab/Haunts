import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Build-time configuration. Values come from environment variables so the same code builds
 * development, preview and production apps. See mobile/.env.example.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';
const BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'app.unfog.mobile';
// Android blocks plain HTTP by default. Allow it only when the API itself is plain HTTP (local testing).
const allowCleartext = API_URL.startsWith('http://');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Haunts',
  slug: 'unfog',
  scheme: 'unfog',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#07070C',
  platforms: ['ios', 'android'],
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#07070C',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Only what the app uses. expo-location adds the location and foreground-service permissions.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { backgroundColor: '#07070C', image: './assets/images/splash-icon.png', imageWidth: 120 },
    ],
    'expo-sqlite',
    'expo-secure-store',
    'expo-sharing',
    '@maplibre/maplibre-react-native',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Haunts reveals the parts of your city you visit. Your location is turned into map blocks on your phone and never shared live.',
        locationAlwaysAndWhenInUsePermission:
          'Allow "Always" so Haunts can keep revealing your map while the app is closed. Home and other private zones are never recorded.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/images/notification-icon.png',
      },
    ],
    ['expo-build-properties', { android: { usesCleartextTraffic: allowCleartext } }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiUrl: API_URL,
  },
});
