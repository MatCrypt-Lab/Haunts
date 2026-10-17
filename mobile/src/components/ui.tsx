import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, radius, space, type } from '@/constants/theme';

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  refreshing,
  onRefresh,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: ViewStyle;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, style]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} /> : undefined
          }>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function T({ variant = 'body', muted, style, ...rest }: TextProps & { variant?: keyof typeof type; muted?: boolean }) {
  return <Text style={[type[variant], { color: muted ? colors.textMuted : colors.text }, style]} {...rest} />;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: ReactNode;
}) {
  const bg = { primary: colors.accent, secondary: colors.surfaceRaised, danger: 'transparent', ghost: 'transparent' }[variant];
  const fg = { primary: colors.accentText, secondary: colors.text, danger: colors.danger, ghost: colors.textMuted }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: colors.danger },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[type.body, { color: fg, fontWeight: '700' }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label?: string; error?: string | null }>(function Field(
  { label, error, style, ...rest },
  ref,
) {
  return (
    <View style={{ gap: space.xs }}>
      {label ? <T variant="label" muted>{label}</T> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? <T variant="small" style={{ color: colors.danger }}>{error}</T> : null}
    </View>
  );
});

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.stat}>
      <T variant="label" muted>{label}</T>
      <T variant="title">{value}</T>
      {hint ? <T variant="small" muted>{hint}</T> : null}
    </View>
  );
}

export function Progress({ value, color = colors.accent }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.track}>
      <View style={[styles.bar, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Chip({ label, color = colors.surfaceRaised, textColor = colors.text }: { label: string; color?: string; textColor?: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Text style={[type.small, { color: textColor, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="heading">{title}</T>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function Loading() {
  return (
    <View style={[styles.fill, styles.center]}>
      <ActivityIndicator color={colors.textMuted} />
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ gap: space.sm }}>
      <T muted>{message}</T>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl * 2 },
  button: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: space.lg,
    fontSize: 17,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  stat: { flex: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: 2, borderWidth: 1, borderColor: colors.border },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
});
