import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatDuration } from '@unfog/core';
import { PlaceForm } from '@/components/place-form';
import { Button, Card, Loading, Row, Screen, Section, Stat, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { dateLabel, timeOfDay } from '@/lib/format';
import { deletePlace, getPlace, updatePlace, type PlaceSummary, type StayView } from '@/lib/memory';

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<{ place: PlaceSummary; visits: StayView[] } | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => void getPlace(String(id)).then(setData), [id]);
  useFocusEffect(load);

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen edges={[]}>
        <T muted>This place no longer exists.</T>
      </Screen>
    );
  }
  const { place, visits } = data;

  const remove = () =>
    Alert.alert(`Forget ${place.name}?`, 'The name is removed. Your visits stay in your timeline as unnamed stops.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => void deletePlace(place.id).then(() => router.back()),
      },
    ]);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: place.name }} />
      {editing ? (
        <PlaceForm
          initial={{ name: place.name, emoji: place.emoji, note: place.note ?? '' }}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await updatePlace(place.id, { name: v.name, emoji: v.emoji, note: v.note });
            setEditing(false);
            load();
          }}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <T variant="title">{place.emoji ? `${place.emoji} ` : ''}{place.name}</T>
          {place.note ? <T muted>{place.note}</T> : null}
          <Row>
            <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} style={{ flex: 1 }} />
            <Button title="Forget place" variant="danger" onPress={remove} style={{ flex: 1 }} />
          </Row>
        </View>
      )}

      <Row style={{ flexWrap: 'wrap' }}>
        <Stat label="Visits" value={String(place.visits)} />
        <Stat label="Time here" value={place.totalMs ? formatDuration(place.totalMs) : '0m'} />
      </Row>
      {place.firstVisit ? (
        <Card>
          <T muted>First visit {dateLabel(place.firstVisit)}. Last visit {dateLabel(place.lastVisit!)}.</T>
        </Card>
      ) : null}

      <Section title="Visits">
        {visits.length === 0 ? <T muted>No visits recorded yet.</T> : null}
        {visits.map((v) => (
          <View key={v.start} style={styles.visit}>
            <T style={{ fontWeight: '700', flex: 1 }}>{dateLabel(v.start)}</T>
            <T muted variant="small">
              {timeOfDay(v.start)} to {timeOfDay(v.end)} · {formatDuration(v.end - v.start)}
            </T>
          </View>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  visit: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
});
