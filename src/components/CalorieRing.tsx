import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { fmt } from '@/lib/nutrition';
import { useTheme } from '@/lib/theme';

export function CalorieRing({ eaten, goal, size = 190 }: { eaten: number; goal: number; size?: number }) {
  const t = useTheme();
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, eaten / goal) : 0;
  const over = eaten > goal;
  const remaining = Math.round(goal - eaten);

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${fmt(eaten)} von ${fmt(goal)} kcal gegessen`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? t.over : t.primary}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.center}>
          <Text style={[styles.big, { color: over ? t.over : t.text }]}>{fmt(Math.abs(remaining))}</Text>
          <Text style={[styles.small, { color: t.muted }]}>{over ? 'kcal zu viel' : 'kcal übrig'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  big: { fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'] },
  small: { fontSize: 14, marginTop: 2 },
});
