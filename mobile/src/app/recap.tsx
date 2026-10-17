import { useState } from 'react';
import { View } from 'react-native';
import { deviceDayKey, monthKey, monthRange, addDays, previousMonth } from '@unfog/core';
import { Button, Card, ErrorNote, Loading, Row, Screen, Stat, T } from '@/components/ui';
import { colors, space } from '@/constants/theme';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useRecap } from '@/lib/queries';

const nextMonth = (m: string) => monthKey(monthRange(m).endExclusive);
const label = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function RecapScreen() {
  const me = useMe();
  const current = monthKey(deviceDayKey());
  const earliest = monthKey(addDays(me.createdAt.slice(0, 10), 0));
  const [month, setMonth] = useState(current);
  const recap = useRecap(month);
  const r = recap.data;
  const color = me.crew?.color ?? colors.accent;

  return (
    <Screen edges={[]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="Previous" variant="ghost" onPress={() => setMonth(previousMonth(month))} disabled={month <= earliest} />
        <T variant="heading">{label(month)}</T>
        <Button title="Next" variant="ghost" onPress={() => setMonth(nextMonth(month))} disabled={month >= current} />
      </Row>
      {recap.isPending ? <Loading /> : null}
      {recap.isError ? <ErrorNote message={errorMessage(recap.error)} onRetry={() => void recap.refetch()} /> : null}
      {r ? (
        <View style={{ gap: space.xl }}>
          <Card style={{ gap: space.sm, borderColor: color }}>
            <T variant="label" muted>New ground</T>
            <T variant="hero" style={{ color }}>{r.newCells.toLocaleString()}</T>
            <T muted>blocks you had never been to before</T>
          </Card>
          {r.city ? (
            <Card style={{ gap: space.sm }}>
              <T variant="label" muted>{r.city.name}</T>
              <T variant="title">
                {r.city.pctStart.toFixed(2)}% → {r.city.pctEnd.toFixed(2)}%
              </T>
              <T muted>explored at the start and end of the month</T>
            </Card>
          ) : null}
          <Row style={{ flexWrap: 'wrap' }}>
            <Stat label="Days out" value={String(r.activeDays)} />
            <Stat label="Block-days" value={r.cellDays.toLocaleString()} />
            <Stat label="Drops found" value={String(r.dropsFound)} />
          </Row>
          {r.topNeighbourhoods.length ? (
            <Card style={{ gap: space.sm }}>
              <T variant="label" muted>Where you spent the month</T>
              {r.topNeighbourhoods.map((n, i) => (
                <Row key={n.id} style={{ justifyContent: 'space-between' }}>
                  <T style={{ fontWeight: '700' }}>{i + 1}. {n.name}</T>
                  <T muted>{n.cellDays}</T>
                </Row>
              ))}
            </Card>
          ) : null}
          {r.pioneered.length ? (
            <Card style={{ gap: space.sm, borderColor: colors.warning }}>
              <T variant="label" style={{ color: colors.warning }}>Pioneer</T>
              <T variant="heading">{r.pioneered.map((p) => p.name).join(', ')}</T>
              <T muted>First to explore a quarter of it.</T>
            </Card>
          ) : null}
          {r.newCells === 0 && r.activeDays === 0 ? <T muted>Nothing this month yet. Go outside.</T> : null}
        </View>
      ) : null}
    </Screen>
  );
}
