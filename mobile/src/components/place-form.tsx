import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Field, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';

export const PLACE_EMOJI = ['☕', '🍜', '🍻', '🏠', '💼', '🎓', '🏋️', '🌳', '🛍️', '🎵', '❤️', '⭐'];

export type PlaceFormValue = { name: string; emoji: string | null; note: string };

export function PlaceForm({ initial, submitLabel, onSubmit }: { initial: PlaceFormValue; submitLabel: string; onSubmit: (v: PlaceFormValue) => Promise<void> }) {
  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState<string | null>(initial.emoji);
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: space.lg }}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Third Wave, Indiranagar" maxLength={60} autoFocus={!initial.name} />
      <View style={{ gap: space.xs }}>
        <T variant="label" muted>Icon</T>
        <View style={styles.emojiWrap}>
          {PLACE_EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => setEmoji(emoji === e ? null : e)}
              accessibilityRole="button"
              accessibilityState={{ selected: emoji === e }}
              style={[styles.emoji, emoji === e && styles.emojiOn]}>
              <T style={{ fontSize: 22 }}>{e}</T>
            </Pressable>
          ))}
        </View>
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Order the cold brew" maxLength={280} multiline style={{ minHeight: 80, paddingTop: 14 }} />
      <Button
        title={submitLabel}
        loading={busy}
        disabled={name.trim().length < 1}
        onPress={async () => {
          setBusy(true);
          try {
            await onSubmit({ name, emoji, note });
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  emojiWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  emoji: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emojiOn: { borderColor: colors.accent },
});
