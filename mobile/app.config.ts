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
    // expo-task-manager schedules its location jobs as persisted, so they survive a reboot.
    // Android refuses persisted jobs without this permission and the app crashes on the
    // first background update.
    permissions: ['android.permission.RECEIVE_BOOT_COMPLETED'],
    // Only what the app uses. expo-location adds the location and foreground-service permissions.
    // The microphone is used only while the user holds Ask's voice button.
    blockedPermissions: [
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
    [
      'expo-image-picker',
      {
        cameraPermission: 'Take a photo of a sign, menu or building and Haunts AI tells you what it is.',
        photosPermission: 'Pick a photo to ask Haunts AI about.',
      },
    ],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Ask Haunts AI questions by voice.',
        speechRecognitionPermission: 'Turn what you say into a question for Haunts AI.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#00C2FF' }],
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
