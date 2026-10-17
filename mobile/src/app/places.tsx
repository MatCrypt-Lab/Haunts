import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { formatDuration } from '@unfog/core';
import { Screen, Section, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { dateLabel } from '@/lib/format';
import { listPlaces, suggestions, type PlaceSummary } from '@/lib/memory';

type Suggestion = Awaited<ReturnType<typeof suggestions>>[number];

export default function PlacesScreen() {
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [suggested, setSuggested] = useState<Suggestion[]>([]);

  useFocusEffect(
    useCallback(() => {
      void listPlaces().then(setPlaces);
      void suggestions().then(setSuggested);
    }, []),
  );

  return (
    <Screen edges={[]}>
      {suggested.length > 0 ? (
        <Section title="You keep coming back here">
          {suggested.map((s) => (
            <Pressable
              key={s.cell}
              style={styles.row}
              onPress={() => router.push({ pathname: '/place-new', params: { lat: String(s.lat), lng: String(s.lng), name: s.name ?? '' } })}>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700' }}>{s.name ?? 'Unnamed spot'}</T>
                <T muted variant="small">{s.visits} visits</T>
              </View>
              <T variant="small" style={{ color: colors.accent, fontWeight: '700' }}>Name it</T>
            </Pressable>
          ))}
        </Section>
      ) : null}

      <Section title="Saved places">
        {places.length === 0 ? <T muted>Name a stop in Memory and it appears here, with every visit you have made.</T> : null}
        {places.map((p) => (
          <Pressable key={p.id} style={styles.row} onPress={() => router.push({ pathname: '/place/[id]', params: { id: p.id } })}>
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '700' }}>{p.emoji ? `${p.emoji} ` : ''}{p.name}</T>
              <T muted variant="small">
                {p.visits} visit{p.visits === 1 ? '' : 's'}
                {p.totalMs ? ` · ${formatDuration(p.totalMs)} in total` : ''}
              </T>
            </View>
            <T muted variant="small">{p.lastVisit ? dateLabel(p.lastVisit) : ''}</T>
          </Pressable>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
});
