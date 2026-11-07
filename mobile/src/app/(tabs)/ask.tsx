import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { AiPhoneCall, AiPlace, AiRoute, AiTurn } from '@unfog/core';
import { Button, Card, Progress, Row, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { aiApi, addToWishlist, currentCell, getAiSettings, localTimeIso, setAiSettings, showOnMap } from '@/lib/ai';
import { runPhoneTool } from '@/lib/ai-memory';
import { ApiError, errorMessage } from '@/lib/api';
import { kvGet, kvSet } from '@/lib/local-db';

type Item =
  | { kind: 'user'; text: string; imageUri?: string }
  | { kind: 'ai'; turn: AiTurn; shared: string[] }
  | { kind: 'error'; text: string };

const STARTERS = [
  "Quiet cafe nearby I haven't tried",
  'Plan a 30-minute walk that paints new blocks',
  'Plan Saturday evening for 4 of us, ₹1,500 each',
  'Where did I spend the most time this month?',
  'Will it rain in the next hour?',
  'How is my crew doing this week?',
];

const CHAT_KEY = 'ai_chat';
const DECLINED = 'The user chose not to share their private memory. Carry on without it.';

export default function AskScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ calls: AiPhoneCall[]; resolve: (ok: boolean) => void } | null>(null);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const quests = useQuery({ queryKey: ['ai', 'quests'], queryFn: aiApi.quests, staleTime: 5 * 60_000, retry: false });

  // Restore the last conversation on this phone (text only).
  useEffect(() => {
    void (async () => {
      setSpeak((await getAiSettings()).speakReplies);
      const saved = await kvGet(CHAT_KEY).catch(() => null);
      if (!saved) return;
      try {
        const s = JSON.parse(saved) as { items: Item[]; state?: string };
        setItems(s.items.map((i) => (i.kind === 'user' ? { kind: 'user', text: i.text } : i)));
        setState(s.state);
      } catch {
        // Ignore a corrupt saved chat.
      }
    })();
  }, []);

  const persist = useCallback((next: Item[], nextState?: string) => {
    void kvSet(CHAT_KEY, JSON.stringify({ items: next.slice(-30), state: nextState })).catch(() => {});
  }, []);

  const append = (item: Item) => setItems((cur) => [...cur, item]);

  /** Runs phone tools (after asking once) until the agent answers. */
  const resolveTurn = async (first: AiTurn): Promise<{ turn: AiTurn; shared: string[] }> => {
    let turn = first;
    const shared: string[] = [];
    while (turn.pending.length) {
      let allowed = (await getAiSettings()).memoryConsent;
      if (allowed === null) {
        allowed = await new Promise<boolean>((resolve) => setConsent({ calls: turn.pending, resolve }));
        setConsent(null);
        await setAiSettings({ memoryConsent: allowed });
      }
      setBusy(allowed ? 'Checking your memory on this phone…' : 'Thinking…');
      const results = await Promise.all(
        turn.pending.map(async (call) => {
          if (!allowed) return { id: call.id, output: DECLINED };
          try {
            const r = await runPhoneTool(call);
            shared.push(r.shared);
            return { id: call.id, output: r.output };
          } catch (err) {
            return { id: call.id, output: errorMessage(err), isError: true };
          }
        }),
      );
      setBusy('Thinking…');
      turn = await aiApi.toolResults({ state: turn.state, results });
    }
    return { turn, shared };
  };

  const send = async (text: string, image?: { uri: string; data: string }) => {
    const message = text.trim();
    if ((!message && !image) || busy) return;
    setInput('');
    const userItem: Item = { kind: 'user', text: message || 'What is this?', imageUri: image?.uri };
    append(userItem);
    setBusy('Thinking…');
    try {
      const cell = await currentCell();
      const ask = (s: string | undefined) =>
        aiApi.chat({
          message: message || 'What is this? Tell me what I am looking at and anything useful about it.',
          cell,
          localTime: localTimeIso(),
          state: s,
          image: image ? { mediaType: 'image/jpeg', data: image.data } : undefined,
        });
      // Conversations expire after a few hours; carry on in a fresh one.
      const first = await ask(state).catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'invalid_state') return ask(undefined);
        throw err;
      });
      const { turn, shared } = await resolveTurn(first);
      setState(turn.state);
      setItems((cur) => {
        const next: Item[] = [...cur, { kind: 'ai', turn, shared }];
        persist(next, turn.state);
        return next;
      });
      if (speak && turn.reply) Speech.speak(turn.reply.message, { language: 'en-IN' });
    } catch (err) {
      append({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const takePhoto = async (fromLibrary: boolean) => {
    const perm = fromLibrary ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const r = fromLibrary
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = r.canceled ? null : r.assets[0];
    if (!asset) return;
    // Small enough to send quickly, big enough to read a sign or menu.
    const ref = await ImageManipulator.manipulate(asset.uri).resize({ width: 1280 }).renderAsync();
    const out = await ref.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
    if (out.base64) await send(input, { uri: out.uri, data: out.base64 });
  };

  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results[0]?.transcript ?? '';
    setInput(t);
    if (e.isFinal && t) void send(t);
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));

  const toggleMic = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return;
    setListening(true);
    ExpoSpeechRecognitionModule.start({ lang: 'en-IN', interimResults: true });
  };

  const toggleSpeak = async () => {
    const next = !speak;
    setSpeak(next);
    if (!next) void Speech.stop();
    await setAiSettings({ speakReplies: next });
  };

  const reset = () => {
    setItems([]);
    setState(undefined);
    void kvSet(CHAT_KEY, null);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Row style={styles.header}>
          <View style={{ flex: 1 }}>
            <T variant="title">Ask Haunts</T>
            <T variant="small" muted>Your city, your memory, your crew.</T>
          </View>
          <IconButton name={speak ? 'volume-high' : 'volume-mute'} label={speak ? 'Stop reading replies aloud' : 'Read replies aloud'} onPress={toggleSpeak} />
          {items.length ? <IconButton name="add-circle-outline" label="New conversation" onPress={reset} /> : null}
        </Row>

        <ScrollView ref={scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {items.length === 0 ? (
            <>
              {quests.data?.quests.length ? (
                <Card style={{ gap: space.md }}>
                  <T variant="label" muted>Today’s quests</T>
                  {quests.data.quests.map((q) => (
                    <View key={q.id} style={{ gap: space.xs }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <T style={{ fontWeight: '700', flex: 1 }}>{q.done ? '✓ ' : ''}{q.title}</T>
                        <T variant="small" muted>{q.progress}/{q.target}</T>
                      </Row>
                      <T variant="small" muted>{q.description}</T>
                      <Progress value={(q.progress / q.target) * 100} color={q.done ? colors.success : colors.accent} />
                    </View>
                  ))}
                </Card>
              ) : quests.isLoading ? (
                <Card><T muted>Writing today’s quests…</T></Card>
              ) : null}
              <T variant="label" muted>Try asking</T>
              <View style={styles.chips}>
                {STARTERS.map((s) => (
                  <Suggestion key={s} text={s} onPress={() => void send(s)} />
                ))}
              </View>
              <T variant="small" muted>
                Haunts AI uses your current map block (about 60 m) to find things nearby. Your memory stays on this phone; when a question needs it, the phone answers with a short summary, only if you allow it.
              </T>
            </>
          ) : null}

          {items.map((item, i) => (
            <Message key={i} item={item} onSuggestion={(s) => void send(s)} />
          ))}

          {consent ? (
            <Card style={{ gap: space.md, borderColor: colors.accent, borderWidth: 1 }}>
              <T variant="heading">Use your memory?</T>
              <T muted>
                To answer, Haunts AI wants to ask this phone: {consent.calls.map((c) => DESCRIBE[c.name]).join('; ')}. Only a short summary is shared, never your timeline or exact locations.
              </T>
              <Row>
                <Button title="Allow" onPress={() => consent.resolve(true)} style={{ flex: 1 }} />
                <Button title="Not now" variant="secondary" onPress={() => consent.resolve(false)} style={{ flex: 1 }} />
              </Row>
              <T variant="small" muted>You can change this any time in Me.</T>
            </Card>
          ) : null}

          {busy && !consent ? (
            <Row style={{ gap: space.sm }}>
              <ActivityIndicator color={colors.accent} />
              <T muted>{busy}</T>
            </Row>
          ) : null}
        </ScrollView>

        <Row style={styles.composer}>
          <IconButton name="camera-outline" label="Take a photo to ask about" onPress={() => void takePhoto(false)} onLongPress={() => void takePhoto(true)} />
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={listening ? 'Listening…' : 'Ask anything about your city'}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            multiline
            onSubmitEditing={() => void send(input)}
          />
          <IconButton name={listening ? 'stop-circle' : 'mic-outline'} label={listening ? 'Stop listening' : 'Ask by voice'} onPress={() => void toggleMic()} active={listening} />
          <IconButton name="arrow-up-circle" label="Send" onPress={() => void send(input)} disabled={!input.trim() || !!busy} active />
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const DESCRIBE: Record<AiPhoneCall['name'], string> = {
  check_visited: 'whether you have been to some places nearby',
  memory_query: 'a question about where you have been',
  taste_profile: 'the kinds of places you like',
  saved_places: 'the names of your saved places',
};

function Message({ item, onSuggestion }: { item: Item; onSuggestion: (s: string) => void }) {
  if (item.kind === 'user') {
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.photo} accessibilityLabel="Photo you sent" /> : null}
        <T style={{ color: colors.accentText }}>{item.text}</T>
      </View>
    );
  }
  if (item.kind === 'error') {
    return (
      <View style={[styles.bubble, styles.aiBubble]}>
        <T style={{ color: colors.danger }}>{item.text}</T>
      </View>
    );
  }
  const { reply, places, routes } = item.turn;
  if (!reply) return null;
  const byId = new Map(places.map((p) => [p.id, p]));
  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.bubble, styles.aiBubble]}>
        <T>{reply.message}</T>
      </View>
      {item.shared.length ? (
        <View style={styles.chips}>
          {item.shared.map((s, i) => (
            <View key={i} style={styles.sharedChip}>
              <Ionicons name="lock-closed" size={12} color={colors.textMuted} />
              <T variant="small" muted>Shared from your phone: {s}</T>
            </View>
          ))}
        </View>
      ) : null}
      {reply.itinerary.length ? (
        <Card style={{ gap: space.sm }}>
          <T variant="label" muted>Plan</T>
          {reply.itinerary.map((s, i) => (
            <Row key={i} style={{ alignItems: 'flex-start' }}>
              <T variant="small" style={{ width: 70, color: colors.accent, fontWeight: '700' }}>{s.time}</T>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700' }}>{s.title}</T>
                {s.note ? <T variant="small" muted>{s.note}</T> : null}
              </View>
            </Row>
          ))}
          {places.length || routes.length ? <Button title="See the plan on the map" variant="secondary" onPress={() => openMap(places, routes)} /> : null}
        </Card>
      ) : null}
      {routes.map((r) => (
        <RouteCard key={r.id} route={r} onPress={() => openMap(places, [r])} />
      ))}
      {reply.placeIds.map((id) => byId.get(id)).filter((p): p is AiPlace => !!p).map((p) => (
        <PlaceCard key={p.id} place={p} />
      ))}
      {reply.suggestions.length ? (
        <View style={styles.chips}>
          {reply.suggestions.map((s) => (
            <Suggestion key={s} text={s} onPress={() => onSuggestion(s)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function openMap(places: AiPlace[], routes: AiRoute[], focus?: AiPlace) {
  showOnMap(places, routes, focus);
  router.navigate('/');
}

function PlaceCard({ place }: { place: AiPlace }) {
  const [saved, setSaved] = useState(false);
  const extras = [place.details.cuisine, place.details.internet_access === 'wlan' || place.details.internet_access === 'yes' ? 'wifi' : null, place.details.outdoor_seating === 'yes' ? 'outdoor seating' : null].filter(Boolean);
  return (
    <Card style={{ gap: space.xs }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700', flex: 1 }}>{place.name}</T>
        <T variant="small" muted>{place.distanceM < 1000 ? `${place.distanceM} m` : `${(place.distanceM / 1000).toFixed(1)} km`}</T>
      </Row>
      <T variant="small" muted>{[place.category.replace('_', ' '), ...extras, place.address].filter(Boolean).join(' · ')}</T>
      {place.openingHours ? <T variant="small" muted>Hours: {place.openingHours}</T> : null}
      <Row>
        <Button title="Map" variant="secondary" onPress={() => openMap([place], [], place)} style={{ flex: 1 }} />
        <Button
          title={saved ? 'Saved' : 'Save to try'}
          variant="secondary"
          disabled={saved}
          onPress={() => void addToWishlist(place).then(() => setSaved(true))}
          style={{ flex: 1 }}
        />
      </Row>
    </Card>
  );
}

function RouteCard({ route, onPress }: { route: AiRoute; onPress: () => void }) {
  return (
    <Card style={{ gap: space.xs }}>
      <T style={{ fontWeight: '700' }}>{route.title}</T>
      <T variant="small" muted>
        {(route.distanceM / 1000).toFixed(1)} km · {route.durationMin} min
        {route.newBlocks !== undefined ? ` · ${route.newBlocks} new blocks` : ''}
        {route.dropsOnRoute ? ` · ${route.dropsOnRoute} hidden drop${route.dropsOnRoute === 1 ? '' : 's'}` : ''}
      </T>
      <Button title="Show on map" onPress={onPress} />
    </Card>
  );
}

function Suggestion({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.7 }]}>
      <T variant="small">{text}</T>
    </Pressable>
  );
}

function IconButton({
  name,
  label,
  onPress,
  onLongPress,
  disabled,
  active,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} disabled={disabled} hitSlop={8} style={{ opacity: disabled ? 0.35 : 1, padding: space.xs }}>
      <Ionicons name={name} size={28} color={active ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  bubble: { padding: space.md, borderRadius: radius.lg, maxWidth: '88%', gap: space.sm },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: colors.surfaceRaised },
  photo: { width: 200, height: 150, borderRadius: radius.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  suggestion: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.surface },
  sharedChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 2 },
  composer: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: space.sm, paddingVertical: space.sm, gap: space.xs, alignItems: 'flex-end' },
  input: { flex: 1, color: colors.text, fontSize: 16, maxHeight: 120, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg },
});
