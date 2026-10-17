import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { colors, radius, space } from '@/constants/theme';
import { on } from '@/lib/events';
import { keys } from '@/lib/queries';
import { takeUnseenRewards } from '@/lib/sync';
import { T } from './ui';

type Item = { id: string; title: string; body: string };

/** Celebrates drops and titles, including ones earned while the app was closed. */
export function RewardsBanner() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<Item[]>([]);

  useEffect(() => {
    const show = async () => {
      const r = await takeUnseenRewards();
      if (!r) return;
      const items: Item[] = [
        ...r.drops.map((d) => ({
          id: `d-${d.id}`,
          title: d.sponsor ? `${d.sponsor} drop found` : 'Drop found',
          body: d.title,
        })),
        ...r.titles.map((t) => ({ id: `t-${t.neighbourhoodId}`, title: 'New title: Pioneer', body: `First to explore a quarter of ${t.neighbourhoodName}` })),
      ];
      if (items.length) {
        setQueue((q) => [...q, ...items]);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void queryClient.invalidateQueries({ queryKey: keys.drops });
        void queryClient.invalidateQueries({ queryKey: keys.titles });
      }
    };
    void show();
    const offRewards = on('rewards', () => void show());
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void show());
    return () => {
      offRewards();
      sub.remove();
    };
  }, [queryClient]);

  useEffect(() => {
    if (queue.length === 0) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 5000);
    return () => clearTimeout(t);
  }, [queue]);

  const current = queue[0];
  if (!current) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <Pressable onPress={() => setQueue((q) => q.slice(1))} style={styles.banner} accessibilityRole="alert">
        <T variant="heading">{current.title}</T>
        <T muted>{current.body}</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, zIndex: 100 },
  banner: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 2,
  },
});
