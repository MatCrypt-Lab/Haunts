import { Pressable, StyleSheet, View } from 'react-native';
import { CREW_COLORS } from '@unfog/core';
import { colors } from '@/constants/theme';

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: (typeof CREW_COLORS)[number]) => void }) {
  return (
    <View style={styles.wrap}>
      {CREW_COLORS.map((c) => (
        <Pressable
          key={c}
          accessibilityRole="button"
          accessibilityLabel={`Colour ${c}`}
          accessibilityState={{ selected: value === c }}
          onPress={() => onChange(c)}
          style={[styles.swatch, { backgroundColor: c }, value === c && styles.selected]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  selected: { borderColor: colors.text },
});
