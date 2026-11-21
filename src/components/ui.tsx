import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: t.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : variant === 'danger' ? 'transparent' : t.primarySoft;
  const fg = variant === 'primary' ? t.onPrimary : variant === 'danger' ? t.danger : t.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: t.danger },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? t.primary : t.border, backgroundColor: selected ? t.primarySoft : t.card },
      ]}
    >
      <Text style={{ color: selected ? t.primary : t.text, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  suffix,
  style,
  ...props
}: TextInputProps & { label: string; suffix?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ flex: 1 }, style]}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      <View style={[styles.fieldBox, { borderColor: t.border, backgroundColor: t.bg }]}>
        <TextInput
          placeholderTextColor={t.muted}
          style={[styles.fieldInput, { color: t.text }]}
          {...props}
        />
        {suffix ? <Text style={{ color: t.muted }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const t = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={[styles.track, { backgroundColor: t.track }]}>
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: value > max ? t.over : color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 16, borderWidth: StyleSheet.hairlineWidth },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  button: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  fieldInput: { flex: 1, fontSize: 16, paddingVertical: 11 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
