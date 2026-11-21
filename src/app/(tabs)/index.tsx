import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CalorieRing } from '@/components/CalorieRing';
import { Card, ProgressBar } from '@/components/ui';
import { addDays, formatDay, todayKey } from '@/lib/date';
import { fmt, sum } from '@/lib/nutrition';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { MEALS, type Entry } from '@/lib/types';

const WATER_GOAL = 8;

export default function DiaryScreen() {
  const t = useTheme();
  const { entries, goals, removeEntry, addEntry, waterByDate, setWater, onboarded } = useStore();
  const [date, setDate] = useState(todayKey());

  const dayEntries = useMemo(() => entries.filter((e) => e.date === date), [entries, date]);
  const total = useMemo(() => sum(dayEntries), [dayEntries]);
  const water = waterByDate[date] ?? 0;

  const onEntryPress = (e: Entry) => {
    const buttons: Parameters<typeof Alert.alert>[2] = [
      { text: 'Löschen', style: 'destructive', onPress: () => removeEntry(e.id) },
    ];
    if (date !== todayKey()) {
      buttons.push({
        text: 'Für heute übernehmen',
        onPress: () => {
          const { id, createdAt, ...rest } = e;
          addEntry({ ...rest, date: todayKey() });
        },
      });
    }
    buttons.push({ text: 'Abbrechen', style: 'cancel' });
    Alert.alert(e.name, `${e.grams ? `${fmt(e.grams)} g · ` : ''}${fmt(e.kcal)} kcal`, buttons);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.dateRow}>
        <Pressable hitSlop={12} onPress={() => setDate(addDays(date, -1))} accessibilityLabel="Vorheriger Tag">
          <Text style={[styles.arrow, { color: t.primary }]}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setDate(todayKey())}>
          <Text style={[styles.dateText, { color: t.text }]}>{formatDay(date)}</Text>
        </Pressable>
        <Pressable hitSlop={12} onPress={() => setDate(addDays(date, 1))} accessibilityLabel="Nächster Tag">
          <Text style={[styles.arrow, { color: t.primary }]}>›</Text>
        </Pressable>
      </View>

      {!onboarded && (
        <Pressable onPress={() => router.navigate('/profile')}>
          <Card style={{ backgroundColor: t.primarySoft, borderColor: t.primary }}>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>🎯 Persönliches Ziel einrichten</Text>
            <Text style={{ color: t.muted, marginTop: 4 }}>
              Gib Größe, Gewicht und Aktivität an, um deinen Tagesbedarf zu berechnen.
            </Text>
          </Card>
        </Pressable>
      )}

      <Card style={styles.summary}>
        <CalorieRing eaten={total.kcal} goal={goals.kcal} />
        <View style={styles.statsRow}>
          <Stat label="Ziel" value={fmt(goals.kcal)} />
          <Stat label="Gegessen" value={fmt(total.kcal)} />
        </View>
        <View style={styles.macros}>
          <Macro label="Eiweiß" value={total.protein} goal={goals.protein} color={t.protein} />
          <Macro label="Kohlenhydr." value={total.carbs} goal={goals.carbs} color={t.carbs} />
          <Macro label="Fett" value={total.fat} goal={goals.fat} color={t.fat} />
        </View>
      </Card>

      {MEALS.map((meal) => {
        const items = dayEntries.filter((e) => e.meal === meal.id);
        const kcal = sum(items).kcal;
        return (
          <Card key={meal.id}>
            <View style={styles.mealHeader}>
              <Text style={[styles.mealTitle, { color: t.text }]}>
                {meal.icon} {meal.label}
              </Text>
              <Text style={{ color: t.muted, fontVariant: ['tabular-nums'] }}>{fmt(kcal)} kcal</Text>
            </View>
            {items.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => onEntryPress(e)}
                style={({ pressed }) => [styles.entry, { borderTopColor: t.border, opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={1}>
                    {e.name}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                    {e.grams ? `${fmt(e.grams)} g · ` : ''}E {fmt(e.protein)} · K {fmt(e.carbs)} · F {fmt(e.fat)}
                  </Text>
                </View>
                <Text style={{ color: t.text, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{fmt(e.kcal)}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => router.push({ pathname: '/add', params: { date, meal: meal.id } })}
              style={({ pressed }) => [styles.addBtn, { borderTopColor: t.border, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: t.primary, fontWeight: '700' }}>＋ Hinzufügen</Text>
            </Pressable>
          </Card>
        );
      })}

      <Card>
        <View style={styles.mealHeader}>
          <Text style={[styles.mealTitle, { color: t.text }]}>💧 Wasser</Text>
          <Text style={{ color: t.muted }}>
            {water} / {WATER_GOAL} Gläser · {(water * 0.25).toLocaleString('de-DE')} l
          </Text>
        </View>
        <View style={styles.waterRow}>
          {Array.from({ length: Math.max(WATER_GOAL, water + 1) }).map((_, i) => (
            <Pressable
              key={i}
              hitSlop={4}
              accessibilityLabel={`${i + 1} Gläser`}
              onPress={() => setWater(date, i < water ? i : i + 1)}
              style={[
                styles.glass,
                { borderColor: t.water, backgroundColor: i < water ? t.water : 'transparent' },
              ]}
            />
          ))}
        </View>
        <ProgressBar value={water} max={WATER_GOAL} color={t.water} />
      </Card>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

function Macro({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
      <ProgressBar value={value} max={goal} color={color} />
      <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>
        {fmt(value)} / {fmt(goal)} g
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  arrow: { fontSize: 34, fontWeight: '300', paddingHorizontal: 8 },
  dateText: { fontSize: 18, fontWeight: '700' },
  summary: { alignItems: 'center', gap: 16 },
  statsRow: { flexDirection: 'row', alignSelf: 'stretch' },
  macros: { flexDirection: 'row', gap: 14, alignSelf: 'stretch' },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  mealTitle: { fontSize: 16, fontWeight: '700' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addBtn: { paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  waterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  glass: { width: 26, height: 34, borderWidth: 2, borderRadius: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
});
