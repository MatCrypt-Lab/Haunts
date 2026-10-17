import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { DEFAULT_SOLO_COLOR, addDays, deviceDayKey, formatDuration } from '@unfog/core';
import { DayMap } from '@/components/day-map';
import { Button, Card, Field, Row, Screen, Section, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { useMe } from '@/lib/auth';
import { on } from '@/lib/events';
import { dateLabel, dayLabel, timeOfDay } from '@/lib/format';
import {
  backupStatus,
  getDay,
  nameStays,
  onThisDay,
  rebuildRecentStays,
  searchMemory,
  type BackupStatus,
  type DayView,
  type Memory,
  type SearchResult,
  type StayView,
} from '@/lib/memory';

export default function MemoryScreen() {
  const me = useMe();
  const today = deviceDayKey();
  const [day, setDay] = useState(today);
  const [data, setData] = useState<DayView | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [version, setVersion] = useState(0);
  const color = me.crew?.color ?? DEFAULT_SOLO_COLOR;

  // Reload when this tab is opened, when new fixes land, or when places change.
  useFocusEffect(
    useCallback(() => {
      void rebuildRecentStays()
        .catch(() => {})
        .finally(() => setVersion((v) => v + 1));
      void onThisDay().then(setMemories).catch(() => {});
      void backupStatus().then(setBackup).catch(() => {});
    }, []),
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setVersion((v) => v + 1);
      }, 3000);
    };
    const offMemory = on('memory', bump);
    const offCells = on('cells', bump);
    return () => {
      offMemory();
      offCells();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getDay(day).then(async (d) => {
      if (!alive) return;
      setData(d);
      // Name unknown stops with the phone's geocoder, then show the names.
      if (await nameStays(d.stays)) {
        const again = await getDay(day);
        if (alive) setData(again);
      }
    });
    return () => {
      alive = false;
    };
  }, [day, version]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void searchMemory(query).then((r) => alive && setResults(r)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, version]);

  const nameIt = (s: StayView) =>
    router.push({ pathname: '/place-new', params: { lat: String(s.lat), lng: String(s.lng), name: s.name ?? '' } });
  const openStay = (s: StayView) => (s.placeId ? router.push({ pathname: '/place/[id]', params: { id: s.placeId } }) : nameIt(s));
  const totalOut = data?.stays.reduce((a, s) => a + (s.end - s.start), 0) ?? 0;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <T variant="title">Memory</T>
        <T muted>Everywhere you have been, and for how long. Only you can see this. It never feeds the game.</T>
      </View>

      <Field value={query} onChangeText={setQuery} placeholder="Search places you have been" autoCorrect={false} returnKeyType="search" />
      {query.trim().length >= 2 ? (
        <View style={{ gap: space.sm }}>
          {results.length === 0 ? <T muted>Nothing found. Name places to make them searchable.</T> : null}
          {results.map((r) =>
            r.kind === 'place' ? (
              <Pressable key={`p-${r.id}`} onPress={() => router.push({ pathname: '/place/[id]', params: { id: r.id } })} style={styles.row}>
                <T style={{ fontWeight: '700', flex: 1 }}>{r.emoji ? `${r.emoji} ` : ''}{r.name}</T>
                <T muted variant="small">{r.lastVisit ? dateLabel(r.lastVisit) : 'No visits yet'}</T>
              </Pressable>
            ) : (
              <Pressable
                key={`s-${r.name}`}
                onPress={() => {
                  setQuery('');
                  setDay(r.day);
                }}
                style={styles.row}>
                <T style={{ flex: 1 }}>{r.name}</T>
                <T muted variant="small">{dayLabel(r.day)}</T>
              </Pressable>
            ),
          )}
        </View>
      ) : null}

      {memories.length > 0 ? (
        <View style={{ gap: space.sm }}>
          {memories.map((m) => (
            <Pressable key={m.day} onPress={() => setDay(m.day)} style={[styles.memory, { borderColor: color }]}>
              <T variant="label" style={{ color }}>{m.label}</T>
              <T style={{ fontWeight: '700' }}>
                {m.topName ? `${m.topName}` : `${m.stops} stop${m.stops === 1 ? '' : 's'}`}
                {m.topName && m.stops > 1 ? ` and ${m.stops - 1} more` : ''}
              </T>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="‹" variant="secondary" onPress={() => setDay(addDays(day, -1))} style={styles.navBtn} />
        <Pressable onPress={() => setDay(today)} accessibilityRole="button" accessibilityLabel="Go to today">
          <T variant="heading">{dayLabel(day)}</T>
        </Pressable>
        <Button title="›" variant="secondary" onPress={() => setDay(addDays(day, 1))} disabled={day >= today} style={styles.navBtn} />
      </Row>

      {data && (data.segments.length > 0 || data.stays.length > 0) ? (
        <DayMap segments={data.segments} stays={data.stays} color={color} />
      ) : null}

      <Section title={data?.stays.length ? `${data.stays.length} stop${data.stays.length === 1 ? '' : 's'}` : 'Stops'} right={totalOut ? <T muted variant="small">{formatDuration(totalOut)} in total</T> : undefined}>
        {data && data.stays.length === 0 ? (
          <T muted>{day === today ? 'Nothing yet today. Stops appear once you stay somewhere for 5 minutes.' : 'Nothing recorded this day.'}</T>
        ) : null}
        {data?.stays.map((s) => (
          <Pressable key={s.start} onPress={() => openStay(s)} style={styles.stay}>
            <View style={[styles.dot, { backgroundColor: s.saved ? colors.text : color }]} />
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontWeight: '700' }}>{s.emoji ? `${s.emoji} ` : ''}{s.name ?? 'Unnamed spot'}</T>
              <T muted variant="small">
                {timeOfDay(s.start)} to {timeOfDay(s.end)} · {formatDuration(s.end - s.start)}
              </T>
            </View>
            {!s.saved ? <T variant="small" style={{ color: colors.accent, fontWeight: '700' }}>Name it</T> : null}
          </Pressable>
        ))}
      </Section>

      <Row>
        <Button title="All places" variant="secondary" onPress={() => router.push('/places')} style={{ flex: 1 }} />
      </Row>

      <Card style={{ gap: space.sm }}>
        <T variant="heading">{backup?.enabled ? 'Backed up and encrypted' : 'Never lose your memory'}</T>
        <T muted variant="small">
          {backup?.enabled
            ? backup.lastBackupAt
              ? `Last backup ${dateLabel(backup.lastBackupAt)} at ${timeOfDay(backup.lastBackupAt)}. Only your recovery code can open it.`
              : 'Backup is on. The first one runs shortly.'
            : 'Your timeline lives on this phone. Back it up with end-to-end encryption to keep it when you change phones.'}
        </T>
        <Button title={backup?.enabled ? 'Backup settings' : 'Set up backup'} variant={backup?.enabled ? 'ghost' : 'primary'} onPress={() => router.push('/memory-backup')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  memory: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: 1, gap: 2 },
  navBtn: { minWidth: 56 },
  stay: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
