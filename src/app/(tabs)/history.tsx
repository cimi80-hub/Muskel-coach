import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Chip, SectionTitle } from '@/components/ui';
import { addDays, formatDay, formatShort, todayKey, weekdayShort } from '@/lib/date';
import { fmt, sum } from '@/lib/nutrition';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import type { Nutrients } from '@/lib/types';

const RANGES = [7, 14, 30] as const;
const CHART_HEIGHT = 160;

export default function HistoryScreen() {
  const t = useTheme();
  const { entries, goals } = useStore();
  const [range, setRange] = useState<(typeof RANGES)[number]>(7);

  const days = useMemo(() => {
    const byDate = new Map<string, Nutrients[]>();
    for (const e of entries) {
      const list = byDate.get(e.date) ?? [];
      list.push(e);
      byDate.set(e.date, list);
    }
    const today = todayKey();
    return Array.from({ length: range }, (_, i) => {
      const date = addDays(today, i - range + 1);
      const items = byDate.get(date) ?? [];
      return { date, count: items.length, ...sum(items) };
    });
  }, [entries, range]);

  const logged = days.filter((d) => d.count > 0);
  const avg = logged.length ? sum(logged).kcal / logged.length : 0;
  const onTarget = logged.filter((d) => Math.abs(d.kcal - goals.kcal) <= goals.kcal * 0.1).length;
  const max = Math.max(goals.kcal * 1.25, ...days.map((d) => d.kcal));
  const goalY = (goals.kcal / max) * CHART_HEIGHT;
  const showLabel = (i: number) => range === 7 || i % Math.ceil(range / 7) === (range - 1) % Math.ceil(range / 7);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.chips}>
        {RANGES.map((r) => (
          <Chip key={r} label={`${r} Tage`} selected={range === r} onPress={() => setRange(r)} />
        ))}
      </View>

      <View style={styles.statRow}>
        <StatCard label="Ø pro Tag" value={fmt(avg)} unit="kcal" />
        <StatCard label="Im Zielbereich" value={`${onTarget}/${logged.length}`} unit="Tage (±10 %)" />
      </View>

      <Card>
        <SectionTitle>Kalorien</SectionTitle>
        <View style={{ height: CHART_HEIGHT + 22 }}>
          <View style={[styles.goalLine, { bottom: goalY + 22, borderColor: t.primary }]}>
            <Text style={[styles.goalText, { color: t.primary, backgroundColor: t.card }]}>Ziel {fmt(goals.kcal)}</Text>
          </View>
          <View style={styles.bars}>
            {days.map((d, i) => {
              const h = Math.max(d.kcal > 0 ? 3 : 0, (d.kcal / max) * CHART_HEIGHT);
              const over = d.kcal > goals.kcal * 1.1;
              return (
                <View key={d.date} style={styles.barCol}>
                  <View style={{ height: CHART_HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch', alignItems: 'center' }}>
                    <View
                      style={{
                        height: h,
                        width: '70%',
                        maxWidth: 26,
                        borderRadius: 4,
                        backgroundColor: over ? t.over : t.primary,
                        opacity: d.date === todayKey() ? 1 : 0.8,
                      }}
                    />
                  </View>
                  <Text style={[styles.barLabel, { color: t.muted }]} numberOfLines={1}>
                    {showLabel(i) ? (range === 7 ? weekdayShort(d.date) : formatShort(d.date)) : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle>Tage</SectionTitle>
        {[...days].reverse().map((d) => (
          <View key={d.date} style={[styles.dayRow, { borderTopColor: t.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 15 }}>{formatDay(d.date)}</Text>
              <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                {d.count > 0
                  ? `E ${fmt(d.protein)} g · K ${fmt(d.carbs)} g · F ${fmt(d.fat)} g`
                  : 'Keine Einträge'}
              </Text>
            </View>
            <Text style={{ color: d.kcal > goals.kcal * 1.1 ? t.over : t.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {d.count > 0 ? `${fmt(d.kcal)} kcal` : '–'}
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1 }}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>{unit}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  chips: { flexDirection: 'row', gap: 8 },
  statRow: { flexDirection: 'row', gap: 14 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', flex: 1 },
  barCol: { flex: 1, alignItems: 'center' },
  barLabel: { fontSize: 10, height: 16, marginTop: 6 },
  goalLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', zIndex: 1 },
  goalText: { position: 'absolute', right: 0, top: -18, fontSize: 11, fontWeight: '600', paddingHorizontal: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
