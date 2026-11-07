import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { haversineMeters, type AiJournal, type AiPlace, type AiWrapped, type LatLng } from '@unfog/core';
import { colors, space } from '@/constants/theme';
import { aiApi, getAiSettings, listWishlist, removeFromWishlist, setAiSettings, showOnMap, type AiSettings, type WishPlace } from '@/lib/ai';
import { enableNudgePermission } from '@/lib/ai-ambient';
import { monthSummary, newBlocksOn } from '@/lib/ai-memory';
import { errorMessage } from '@/lib/api';
import { timeOfDay } from '@/lib/format';
import { kvGetJson, kvSetJson } from '@/lib/local-db';
import type { StayView } from '@/lib/memory';
import { Button, Card, Row, Section, T } from './ui';

export const useAiEnabled = () => useQuery({ queryKey: ['ai', 'status'], queryFn: aiApi.status, staleTime: 30 * 60_000 }).data?.enabled ?? false;

function AiLabel({ text }: { text: string }) {
  return (
    <Row style={{ gap: space.xs }}>
      <Ionicons name="sparkles" size={14} color={colors.accent} />
      <T variant="label" style={{ color: colors.accent }}>{text}</T>
    </Row>
  );
}

/** Crew coach and the weekly crew paper, written from this week's real scores. */
export function CrewAi() {
  const enabled = useAiEnabled();
  const coach = useQuery({ queryKey: ['ai', 'coach'], queryFn: aiApi.coach, enabled, staleTime: 30 * 60_000, retry: false });
  const [paperOpen, setPaperOpen] = useState(false);
  const paper = useQuery({ queryKey: ['ai', 'paper'], queryFn: aiApi.paper, enabled: enabled && paperOpen, staleTime: 60 * 60_000, retry: false });
  if (!enabled) return null;
  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.sm }}>
        <AiLabel text="Crew coach" />
        {coach.data ? <T>{coach.data.text}</T> : coach.isError ? <T muted>{errorMessage(coach.error)}</T> : <Busy text="Reading this week’s scores…" />}
      </Card>
      <Pressable accessibilityRole="button" onPress={() => setPaperOpen((v) => !v)}>
        <Card style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AiLabel text="The crew paper" />
            <Ionicons name={paperOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
          </Row>
          {!paperOpen ? (
            <T muted variant="small">This week’s headlines about your crew. Tap to read.</T>
          ) : paper.data ? (
            <View style={{ gap: space.md }}>
              <T variant="heading">{paper.data.headline}</T>
              {paper.data.stories.map((s, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <T style={{ fontWeight: '700' }}>{s.title}</T>
                  <T muted>{s.body}</T>
                </View>
              ))}
            </View>
          ) : paper.isError ? (
            <T muted>{errorMessage(paper.error)}</T>
          ) : (
            <Busy text="Printing this week’s paper…" />
          )}
        </Card>
      </Pressable>
    </View>
  );
}

export function Busy({ text }: { text: string }) {
  return (
    <Row style={{ gap: space.sm }}>
      <ActivityIndicator color={colors.accent} />
      <T muted variant="small">{text}</T>
    </Row>
  );
}

/** Asks before private memory leaves the phone, unless the user already allowed it. */
export async function confirmMemoryUse(what: string): Promise<boolean> {
  if ((await getAiSettings()).memoryConsent === true) return true;
  return new Promise((resolve) =>
    Alert.alert('Use your memory?', `${what} Nothing is stored on the server.`, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Allow', onPress: () => resolve(true) },
    ]),
  );
}

/** A private diary entry for one day, written from its stops. Kept only on this phone. */
export function JournalCard({ day, stays, segments }: { day: string; stays: StayView[]; segments: LatLng[][] }) {
  const enabled = useAiEnabled();
  // Keyed by day so switching days never shows the previous day's entry.
  const [saved, setSaved] = useState<{ day: string; j: AiJournal | null } | null>(null);
  const entry = saved?.day === day ? saved.j : null;
  const setEntry = (j: AiJournal | null) => setSaved({ day, j });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void kvGetJson<AiJournal>(`journal:${day}`)
      .then((j) => setSaved({ day, j }))
      .catch(() => {});
  }, [day]);
  if (!enabled || (stays.length === 0 && !entry)) return null;

  const write = async () => {
    if (!(await confirmMemoryUse("To write it, Haunts AI reads this day's stop names and times."))) return;
    setBusy(true);
    try {
      const km = segments.reduce((sum, seg) => sum + seg.reduce((a, p, i) => (i ? a + haversineMeters(seg[i - 1]!, p) : a), 0), 0) / 1000;
      const j = await aiApi.journal({
        day,
        stops: stays.slice(0, 40).map((s) => ({
          name: (s.name ?? 'an unnamed spot').slice(0, 120),
          start: timeOfDay(s.start),
          end: timeOfDay(s.end),
          minutes: Math.round((s.end - s.start) / 60_000),
        })),
        walkedKm: Math.round(km * 10) / 10,
        newBlocks: await newBlocksOn(day),
      });
      setEntry(j);
      await kvSetJson(`journal:${day}`, j);
    } catch (err) {
      Alert.alert('Could not write it', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.sm }}>
      <AiLabel text="Journal" />
      {entry ? (
        <>
          <T variant="heading">{entry.title}</T>
          <T>{entry.text}</T>
          <Button title="Rewrite" variant="ghost" onPress={() => void write()} loading={busy} />
        </>
      ) : (
        <>
          <T muted>Turn this day’s stops into a short private diary entry.</T>
          <Button title="Write my journal" variant="secondary" onPress={() => void write()} loading={busy} />
        </>
      )}
    </Card>
  );
}

/** Places saved from the companion to try later. */
export function WishlistCard() {
  const [items, setItems] = useState<WishPlace[]>([]);
  useFocusEffect(
    useCallback(() => {
      void listWishlist().then(setItems).catch(() => {});
    }, []),
  );
  if (items.length === 0) return null;
  const asPlace = (w: WishPlace): AiPlace => ({ id: w.id, name: w.name, category: w.category, lat: w.lat, lng: w.lng, distanceM: 0, address: null, openingHours: null, details: {} });
  return (
    <Section title="Want to try">
      {items.map((w) => (
        <Card key={w.id} style={{ gap: space.xs }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '700' }}>{w.name}</T>
              <T variant="small" muted>{w.category.replace('_', ' ')}</T>
            </View>
            <Button title="Map" variant="secondary" onPress={() => { showOnMap([asPlace(w)], []); router.navigate('/'); }} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${w.name}`} hitSlop={8} onPress={() => void removeFromWishlist(w.id).then(() => setItems((cur) => cur.filter((x) => x.id !== w.id)))}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </Row>
        </Card>
      ))}
    </Section>
  );
}

/** A private monthly recap written from local totals, on request. */
export function WrappedCard({ month }: { month: string }) {
  const enabled = useAiEnabled();
  const [saved, setSaved] = useState<{ month: string; w: AiWrapped | null } | null>(null);
  const w = saved?.month === month ? saved.w : null;
  const setW = (x: AiWrapped | null) => setSaved({ month, w: x });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void kvGetJson<AiWrapped>(`wrapped:${month}`)
      .then((x) => setSaved({ month, w: x }))
      .catch(() => {});
  }, [month]);
  if (!enabled) return null;
  const make = async () => {
    if (!(await confirmMemoryUse("To write it, Haunts AI reads this month's totals and your top place and area names."))) return;
    setBusy(true);
    try {
      const s = await monthSummary(month);
      if (s.stops === 0) {
        Alert.alert('Nothing yet', 'There are no stops recorded on this phone for this month.');
        return;
      }
      const r = await aiApi.wrapped(s);
      setW(r);
      await kvSetJson(`wrapped:${month}`, r);
    } catch (err) {
      Alert.alert('Could not write it', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.sm }}>
      <AiLabel text="Your Wrapped" />
      {w ? (
        <>
          <T variant="heading">{w.title}</T>
          <T>{w.text}</T>
          {w.highlights.map((h, i) => (
            <T key={i} style={{ color: colors.accent, fontWeight: '700' }}>• {h}</T>
          ))}
        </>
      ) : (
        <T muted>A private recap of your month from your memory: where you spent it, what was new.</T>
      )}
      <Button title={w ? 'Rewrite' : 'Make my Wrapped'} variant={w ? 'ghost' : 'secondary'} onPress={() => void make()} loading={busy} />
    </Card>
  );
}

/** AI switches in Me. */
export function AiSettingsSection() {
  const enabled = useAiEnabled();
  const [s, setS] = useState<AiSettings | null>(null);
  useFocusEffect(
    useCallback(() => {
      void getAiSettings().then(setS);
    }, []),
  );
  if (!enabled || !s) return null;
  const set = async (patch: Partial<AiSettings>) => setS(await setAiSettings(patch));
  const toggleNudges = async (on: boolean) => {
    if (on && !(await enableNudgePermission())) {
      Alert.alert('Notifications are off', 'Allow notifications for Haunts in Settings to get smart nudges.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    await set({ nudges: on });
  };
  return (
    <Section title="AI">
      <Card style={{ gap: space.lg }}>
        <SettingRow title="Voice walking guide" body="Reads a short story aloud when you walk into a block you have never explored." value={s.voiceGuide} onChange={(v) => void set({ voiceGuide: v })} />
        <SettingRow title="Smart nudges" body="A heads-up when a place you saved is nearby, rain is coming, or you stop somewhere new late at night." value={s.nudges} onChange={(v) => void toggleNudges(v)} />
        <SettingRow title="Read replies aloud" body="Ask speaks its answers." value={s.speakReplies} onChange={(v) => void set({ speakReplies: v })} />
        <SettingRow
          title="Let Ask use my memory"
          body={s.memoryConsent === null ? 'Ask will check with you the first time a question needs your memory.' : 'Your phone answers with short summaries only, never your timeline.'}
          value={s.memoryConsent === true}
          onChange={(v) => void set({ memoryConsent: v })}
        />
      </Card>
    </Section>
  );
}

function SettingRow({ title, body, value, onChange }: { title: string; body: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: '700' }} onPress={() => onChange(!value)}>{title}</T>
        <T variant="small" muted>{body}</T>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent }} accessibilityLabel={title} />
    </Row>
  );
}
