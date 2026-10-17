import { useCallback, useState } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Title } from '@unfog/core';
import { Button, Card, Chip, Progress, Row, Screen, Section, Stat, T } from '@/components/ui';
import { colors, space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { API_URL, APP_VERSION } from '@/lib/config';
import { countPending } from '@/lib/local-db';
import { backupStatus } from '@/lib/memory';
import { useStats, useTitles } from '@/lib/queries';
import { flushPending } from '@/lib/sync';
import { getPermissionState, isTrackingEnabled, isTrackingRunning, setTrackingEnabled, startTracking } from '@/lib/tracking';

const titleLabel = (t: Title) =>
  t.kind === 'pioneer' ? `Pioneer of ${t.neighbourhoodName}` : t.kind === 'territory' ? `${t.crewName} owns ${t.neighbourhoodName}` : `Local legend of ${t.neighbourhoodName}`;

export default function MeScreen() {
  const me = useMe();
  const { signOut } = useAuth();
  const stats = useStats();
  const titles = useTitles();
  const [enabled, setEnabled] = useState(true);
  const [running, setRunning] = useState(false);
  const [bgGranted, setBgGranted] = useState(true);
  const [pending, setPending] = useState(0);

  const loadTracking = useCallback(async () => {
    const [e, r, p, q] = await Promise.all([isTrackingEnabled(), isTrackingRunning(), getPermissionState(), countPending()]);
    setEnabled(e);
    setRunning(r);
    setBgGranted(p.background === 'granted');
    setPending(q);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void loadTracking();
    }, [loadTracking]),
  );

  const toggle = async (v: boolean) => {
    setEnabled(v);
    await setTrackingEnabled(v);
    await loadTracking();
  };

  const deleteAccount = () =>
    Alert.alert('Delete your account?', 'Your map, crew membership, drops, titles, private memory and its backup are deleted for good. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete forever',
        style: 'destructive',
        onPress: async () => {
          try {
            await api('/me', { method: 'DELETE' });
            await signOut('deleted');
          } catch (err) {
            Alert.alert('Could not delete', errorMessage(err));
          }
        },
      },
    ]);

  const s = stats.data;
  return (
    <Screen refreshing={stats.isRefetching} onRefresh={() => void Promise.all([stats.refetch(), titles.refetch(), loadTracking()])}>
      <View style={{ gap: 2 }}>
        <T variant="title">{me.displayName ?? me.username}</T>
        <T muted>@{me.username}{me.crew ? ` · ${me.crew.name}` : ''}</T>
      </View>

      <Row style={{ flexWrap: 'wrap' }}>
        <Stat label="City" value={s?.city ? `${s.city.pct.toFixed(2)}%` : '0%'} hint={s?.city ? `${s.city.explored.toLocaleString()} of ${s.city.total.toLocaleString()}` : undefined} />
        <Stat label="All blocks" value={(s?.totalCells ?? 0).toLocaleString()} />
        <Stat label="This week" value={(s?.weekCellDays ?? 0).toLocaleString()} />
        <Stat label="Streak" value={`${s?.streakDays ?? 0}d`} />
      </Row>

      {titles.data?.length ? (
        <Section title="Titles">
          <Row style={{ flexWrap: 'wrap' }}>
            {titles.data.map((t) => (
              <Chip key={`${t.kind}-${t.neighbourhoodId}`} label={titleLabel(t)} color={t.kind === 'pioneer' ? colors.warning : colors.surfaceRaised} textColor={t.kind === 'pioneer' ? '#000' : colors.text} />
            ))}
          </Row>
        </Section>
      ) : null}

      <Button title="Monthly recap" variant="secondary" onPress={() => router.push('/recap')} />

      {s?.neighbourhoods.length ? (
        <Section title="Neighbourhoods">
          {s.neighbourhoods.slice(0, 12).map((n) => (
            <View key={n.id} style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ fontWeight: '700' }}>{n.name}</T>
                <T muted variant="small">{n.pct.toFixed(1)}%</T>
              </Row>
              <Progress value={n.pct} color={me.crew?.color} />
            </View>
          ))}
        </Section>
      ) : null}

      <Section title="Tracking">
        <Card style={{ gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '700' }}>Reveal my map</T>
              <T muted variant="small">
                {!enabled ? 'Paused. Nothing is recorded.' : running ? 'On, including in the background.' : bgGranted ? 'Starting...' : 'Only while the app is open.'}
              </T>
            </View>
            <Switch value={enabled} onValueChange={toggle} trackColor={{ true: colors.accent }} />
          </Row>
          {enabled && !bgGranted ? (
            <Button
              title="Allow background location"
              variant="secondary"
              onPress={async () => {
                await Linking.openSettings();
              }}
            />
          ) : null}
          {enabled && bgGranted && !running ? <Button title="Restart tracking" variant="secondary" onPress={() => void startTracking().then(loadTracking)} /> : null}
          <T muted variant="small">{pending} blocks waiting to upload.</T>
          {pending > 0 ? (
            <Button
              title="Upload now"
              variant="ghost"
              onPress={() =>
                void flushPending()
                  .then(loadTracking)
                  .catch((e) => Alert.alert('Upload failed', errorMessage(e)))
              }
            />
          ) : null}
        </Card>
        <Button title="Private zones" variant="secondary" onPress={() => router.push('/privacy')} />
      </Section>

      <Section title="Account">
        <T muted variant="small">{me.email}</T>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={async () => {
            const backup = await backupStatus();
            Alert.alert(
              'Sign out?',
              backup.enabled
                ? 'Your memory is backed up one last time, then removed from this phone. Restore it with your recovery code.'
                : 'Your private memory (timeline and places) is removed from this phone and is not backed up. Set up backup in Memory first to keep it.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
              ],
            );
          }}
        />
        <Button title="Delete account" variant="danger" onPress={deleteAccount} />
        <T variant="small" style={{ color: colors.textFaint }}>
          Haunts {APP_VERSION} · {API_URL.replace(/^https?:\/\//, '')} · Map data © OpenStreetMap contributors
        </T>
      </Section>
    </Screen>
  );
}
