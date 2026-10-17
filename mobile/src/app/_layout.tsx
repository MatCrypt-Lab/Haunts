import { useEffect } from 'react';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { useLinkingURL } from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { holdInvite, inviteCodeFromUrl } from '@/lib/pending-invite';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.accent, text: colors.text },
};

function RootNavigator() {
  const auth = useAuth();
  const url = useLinkingURL();
  const signedIn = auth.status === 'signedIn';
  const ready = signedIn && auth.onboarded && auth.me.username !== null;

  useEffect(() => {
    if (auth.status !== 'loading') void SplashScreen.hideAsync();
  }, [auth.status]);

  // Keep an invite opened before the app is ready; the tabs open it once it is.
  useEffect(() => {
    const code = inviteCodeFromUrl(url);
    if (code && !ready) holdInvite(code);
  }, [url, ready]);

  if (auth.status === 'loading') return null;
  const header = { headerShown: true, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerShadowVisible: false };

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !ready}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recap" options={{ ...header, title: 'Monthly recap', presentation: 'modal' }} />
        <Stack.Screen name="privacy" options={{ ...header, title: 'Private zones' }} />
        <Stack.Screen name="challenges" options={{ ...header, title: 'City wars' }} />
        <Stack.Screen name="drop-new" options={{ ...header, title: 'Leave a drop', presentation: 'modal' }} />
        <Stack.Screen name="join/[code]" options={{ ...header, title: 'Join crew' }} />
        <Stack.Screen name="places" options={{ ...header, title: 'Places' }} />
        <Stack.Screen name="place/[id]" options={{ ...header, title: 'Place' }} />
        <Stack.Screen name="place-new" options={{ ...header, title: 'Name this place', presentation: 'modal' }} />
        <Stack.Screen name="memory-backup" options={{ ...header, title: 'Memory backup' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider value={theme}>
              <RootNavigator />
              <StatusBar style="light" />
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
