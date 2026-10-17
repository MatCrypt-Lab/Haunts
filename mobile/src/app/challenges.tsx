import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { ChallengeView } from '@unfog/core';
import { Button, Card, Chip, ErrorNote, Field, Loading, Row, Screen, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { keys, useChallenges } from '@/lib/queries';

export default function ChallengesScreen() {
  const queryClient = useQueryClient();
  const challenges = useChallenges();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ challenges: ChallengeView[] }>('/challenges/join', { method: 'POST', body: { code: code.trim() } });
      queryClient.setQueryData(keys.challenges, r.challenges);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]} refreshing={challenges.isRefetching} onRefresh={() => void challenges.refetch()}>
      <T muted>
        City wars are team battles run by colleges and companies. Every block your team paints in the city during the
        challenge counts.
      </T>
      <Card style={{ gap: space.md }}>
        <T variant="heading">Join with a team code</T>
        <Field value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="ABCD2345" autoCapitalize="characters" maxLength={8} error={error} />
        <Button title="Join team" onPress={join} loading={busy} disabled={code.trim().length < 6} />
      </Card>
      {challenges.isPending ? <Loading /> : null}
      {challenges.isError ? <ErrorNote message={errorMessage(challenges.error)} onRetry={() => void challenges.refetch()} /> : null}
      {challenges.data?.map((c) => <ChallengeCard key={c.id} c={c} />)}
    </Screen>
  );
}

function ChallengeCard({ c }: { c: ChallengeView }) {
  const queryClient = useQueryClient();
  const leave = () =>
    Alert.alert(`Leave ${c.name}?`, 'Your team keeps the blocks you already painted only while you are a member.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () =>
          void api(`/challenges/${c.id}/leave`, { method: 'POST' })
            .then(() => queryClient.invalidateQueries({ queryKey: keys.challenges }))
            .catch((e) => Alert.alert('Error', errorMessage(e))),
      },
    ]);
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="heading" style={{ flex: 1 }}>{c.name}</T>
        <Chip label={c.status === 'live' ? 'Live' : c.status === 'upcoming' ? 'Upcoming' : 'Ended'} color={c.status === 'live' ? colors.success : colors.surfaceRaised} textColor={c.status === 'live' ? '#000' : colors.text} />
      </Row>
      <T muted variant="small">{c.startsOn} to {c.endsOn}</T>
      {c.teams.map((t) => (
        <View key={t.id} style={[styles.team, t.id === c.myTeamId && { borderColor: t.color }]}>
          <T variant="heading" muted style={{ width: 24 }}>{t.rank}</T>
          <View style={[styles.dot, { backgroundColor: t.color }]} />
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }}>{t.name}{t.id === c.myTeamId ? ' (your team)' : ''}</T>
            <T muted variant="small">{t.members} members</T>
          </View>
          <T variant="heading">{t.score.toLocaleString()}</T>
        </View>
      ))}
      {c.myTeamTop.length ? (
        <View style={{ gap: 4 }}>
          <T variant="label" muted>Top on your team</T>
          {c.myTeamTop.slice(0, 5).map((m) => (
            <Row key={m.userId} style={{ justifyContent: 'space-between' }}>
              <T>@{m.username}</T>
              <T muted>{m.score}</T>
            </Row>
          ))}
        </View>
      ) : null}
      <Button title="Leave challenge" variant="ghost" onPress={leave} />
    </Card>
  );
}

const styles = StyleSheet.create({
  team: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: 'transparent' },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
