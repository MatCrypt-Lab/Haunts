import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CREW_COLORS, type CrewDetails } from '@unfog/core';
import { ColorPicker } from '@/components/color-picker';
import { Button, Card, Chip, ErrorNote, Field, Loading, Row, Screen, Section, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { keys, useCrew, useTerritory } from '@/lib/queries';

export default function CrewScreen() {
  const crew = useCrew();
  const territory = useTerritory();
  const refreshing = crew.isRefetching || territory.isRefetching;
  const refresh = () => {
    void crew.refetch();
    void territory.refetch();
  };

  if (crew.isPending) return <Loading />;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {crew.isError ? <ErrorNote message={errorMessage(crew.error)} onRetry={refresh} /> : null}
      {crew.data ? <CrewView crew={crew.data} /> : crew.isSuccess ? <NoCrew /> : null}
      <TerritoryBoard />
      <Card style={{ gap: space.sm }}>
        <T variant="heading">City wars</T>
        <T muted>Got a code from your college or company? Join their team and paint the city together.</T>
        <Button title="Open city wars" variant="secondary" onPress={() => router.push('/challenges')} />
      </Card>
    </Screen>
  );
}

function useCrewMutation() {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  return async (fn: () => Promise<unknown>) => {
    await fn();
    await refreshMe();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.crew }),
      queryClient.invalidateQueries({ queryKey: keys.crewMap }),
      queryClient.invalidateQueries({ queryKey: keys.territory }),
    ]);
  };
}

function NoCrew() {
  const run = useCrewMutation();
  const [name, setName] = useState('');
  const [color, setColor] = useState<(typeof CREW_COLORS)[number]>(CREW_COLORS[4]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (kind: 'create' | 'join') => {
    setBusy(kind);
    setError(null);
    try {
      await run(() =>
        kind === 'create'
          ? api<CrewDetails>('/crews', { method: 'POST', body: { name: name.trim(), color } })
          : api<CrewDetails>('/crews/join', { method: 'POST', body: { code: code.trim() } }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <T variant="title">Find your crew</T>
        <T muted>Crews of up to 20 friends paint the city together and fight for neighbourhoods every week.</T>
      </View>
      {error ? <T style={{ color: colors.danger }}>{error}</T> : null}
      <Card style={{ gap: space.md }}>
        <T variant="heading">Join with a code</T>
        <Field value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="ABC123" autoCapitalize="characters" maxLength={8} />
        <Button title="Join crew" onPress={() => go('join')} loading={busy === 'join'} disabled={code.trim().length < 6} />
      </Card>
      <Card style={{ gap: space.md }}>
        <T variant="heading">Start a crew</T>
        <Field value={name} onChangeText={setName} placeholder="Koramangala Owls" maxLength={30} />
        <ColorPicker value={color} onChange={setColor} />
        <Button title="Create crew" onPress={() => go('create')} loading={busy === 'create'} disabled={name.trim().length < 2} />
      </Card>
    </View>
  );
}

function CrewView({ crew }: { crew: CrewDetails }) {
  const me = useMe();
  const run = useCrewMutation();

  const invite = async () => {
    const link = `unfog://join/${crew.inviteCode}`;
    await Share.share({ message: `Join my crew "${crew.name}" on Haunts. Code: ${crew.inviteCode}\n${link}` });
  };

  const leave = () =>
    Alert.alert('Leave crew?', crew.isOwner && crew.members.length > 1 ? 'Ownership passes to the longest-standing member.' : 'You can rejoin with the invite code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => void run(() => api('/crews/leave', { method: 'POST' })).catch((e) => Alert.alert('Error', errorMessage(e))),
      },
    ]);

  const memberActions = (id: string, name: string) => {
    if (!crew.isOwner || id === me.id) return;
    Alert.alert(name, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove from crew',
        style: 'destructive',
        onPress: () => void run(() => api(`/crews/mine/members/${id}`, { method: 'DELETE' })).catch((e) => Alert.alert('Error', errorMessage(e))),
      },
    ]);
  };

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <Row>
          <View style={[styles.swatch, { backgroundColor: crew.color }]} />
          <T variant="title" style={{ flex: 1 }}>{crew.name}</T>
        </Row>
        <T muted>
          {crew.members.length} of {crew.maxMembers} members
        </T>
      </View>

      <Card style={{ gap: space.md }}>
        <T variant="label" muted>Invite code</T>
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(crew.inviteCode);
            Alert.alert('Copied', 'Invite code copied.');
          }}>
          <T variant="hero" style={{ letterSpacing: 6 }}>{crew.inviteCode}</T>
        </Pressable>
        <Row>
          <Button title="Invite friends" onPress={invite} style={{ flex: 1 }} />
          {crew.isOwner ? (
            <Button
              title="New code"
              variant="secondary"
              onPress={() => void run(() => api('/crews/mine', { method: 'PATCH', body: { rotateInviteCode: true } }))}
            />
          ) : null}
        </Row>
      </Card>

      <Section title="This week">
        {crew.members.map((m, i) => (
          <Pressable key={m.id} onLongPress={() => memberActions(m.id, m.username ?? 'Member')} style={styles.member}>
            <T variant="heading" style={{ width: 24 }} muted>{i + 1}</T>
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '700' }}>
                {m.displayName ?? m.username ?? 'Member'}
                {m.id === me.id ? ' (you)' : ''}
              </T>
              <T variant="small" muted>@{m.username} · {m.totalCells.toLocaleString()} blocks total</T>
            </View>
            {m.isOwner ? <Chip label="Owner" /> : null}
            <T variant="heading" style={{ color: crew.color }}>{m.weekCellDays}</T>
          </Pressable>
        ))}
        {crew.isOwner ? <T variant="small" muted>Long-press a member to remove them.</T> : null}
      </Section>

      <Button title="Leave crew" variant="danger" onPress={leave} />
    </View>
  );
}

function TerritoryBoard() {
  const t = useTerritory();
  if (!t.data) return null;
  const owned = t.data.neighbourhoods.filter((n) => n.owner && n.owner.crewId === t.data.myCrew?.crewId);
  return (
    <Section title="Territory this week" right={<T variant="small" muted>Resets Monday</T>}>
      {t.data.myCrew ? (
        <Card style={{ gap: space.xs }}>
          <T variant="heading">
            Rank {t.data.myCrew.rank} · {t.data.myCrew.owned} neighbourhood{t.data.myCrew.owned === 1 ? '' : 's'}
          </T>
          <T muted variant="small">{owned.length ? owned.map((n) => n.name).join(', ') : 'Go out and claim one. Every block you paint this week counts.'}</T>
        </Card>
      ) : null}
      {t.data.leaderboard.length === 0 ? (
        <T muted>No crew has claimed anything yet this week. Be first.</T>
      ) : (
        t.data.leaderboard.slice(0, 10).map((r) => (
          <View key={r.crewId} style={styles.member}>
            <T variant="heading" style={{ width: 24 }} muted>{r.rank}</T>
            <View style={[styles.dot, { backgroundColor: r.color }]} />
            <T style={{ flex: 1, fontWeight: '700' }}>{r.name}</T>
            <T muted>{r.owned} owned</T>
          </View>
        ))
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  swatch: { width: 28, height: 28, borderRadius: 14 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
});
