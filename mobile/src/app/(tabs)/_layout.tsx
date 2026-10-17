import { useEffect } from 'react';
import { AppState, type ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { RewardsBanner } from '@/components/rewards-banner';
import { colors } from '@/constants/theme';
import { compactOldDays, maybeAutoBackup } from '@/lib/memory';
import { takeInvite } from '@/lib/pending-invite';
import { flushPending, pullCells } from '@/lib/sync';
import { startTracking } from '@/lib/tracking';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const queryClient = useQueryClient();

  // Keep tracking alive, upload the queue and refresh data whenever the app comes forward.
  useEffect(() => {
    const wake = () => {
      void startTracking().catch(() => {});
      void compactOldDays()
        .then(() => maybeAutoBackup())
        .catch(() => {});
      void flushPending()
        .then(() => queryClient.invalidateQueries())
        .catch(() => {});
    };
    wake();
    void pullCells().catch(() => {});
    const invite = takeInvite();
    if (invite) setTimeout(() => router.push({ pathname: '/join/[code]', params: { code: invite } }), 0);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && wake());
    return () => sub.remove();
  }, [queryClient]);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textFaint,
          sceneStyle: { backgroundColor: colors.bg },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Map', tabBarIcon: icon('map') }} />
        <Tabs.Screen name="memory" options={{ title: 'Memory', tabBarIcon: icon('time') }} />
        <Tabs.Screen name="crew" options={{ title: 'Crew', tabBarIcon: icon('people') }} />
        <Tabs.Screen name="card" options={{ title: 'Card', tabBarIcon: icon('sparkles') }} />
        <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: icon('person-circle') }} />
      </Tabs>
      <RewardsBanner />
    </>
  );
}
