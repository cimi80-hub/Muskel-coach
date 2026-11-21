import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, Field } from '@/components/ui';
import { todayKey } from '@/lib/date';
import { entryFromFood, fmt, normalize, parseNum, round1, scale } from '@/lib/nutrition';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { MEALS, type Food, type MealId } from '@/lib/types';

type Mode = 'search' | 'manual';

export default function AddScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; meal?: MealId }>();
  const date = params.date ?? todayKey();
  const [meal, setMeal] = useState<MealId>(params.meal ?? 'snack');
  const [mode, setMode] = useState<Mode>('search');
  const [selected, setSelected] = useState<Food | null>(null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <View style={styles.top}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {MEALS.map((m) => (
            <Chip key={m.id} label={`${m.icon} ${m.label}`} selected={meal === m.id} onPress={() => setMeal(m.id)} />
          ))}
        </ScrollView>
        <View style={[styles.segment, { backgroundColor: t.track }]}>
          {(['search', 'manual'] as Mode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                setMode(m);
                setSelected(null);
              }}
              style={[styles.segmentItem, mode === m && { backgroundColor: t.card }]}
            >
              <Text style={{ color: t.text, fontWeight: mode === m ? '700' : '400' }}>
                {m === 'search' ? 'Lebensmittel' : 'Manuell'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {mode === 'manual' ? (
          <ManualForm date={date} meal={meal} />
        ) : selected ? (
          <PortionForm food={selected} date={date} meal={meal} onBack={() => setSelected(null)} />
        ) : (
          <FoodSearch onSelect={setSelected} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function FoodSearch({ onSelect }: { onSelect: (f: Food) => void }) {
  const t = useTheme();
  const { allFoods, entries, removeCustomFood } = useStore();
  const [query, setQuery] = useState('');

  const recentIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = entries.length - 1; i >= 0 && ids.length < 8; i--) {
      const id = entries[i].foodId;
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [entries]);

  const list = useMemo(() => {
    const q = normalize(query.trim());
    if (q) {
      return allFoods
        .filter((f) => normalize(f.name).includes(q) || normalize(f.category).includes(q))
        .sort((a, b) => Number(normalize(b.name).startsWith(q)) - Number(normalize(a.name).startsWith(q)));
    }
    const byId = new Map(allFoods.map((f) => [f.id, f]));
    const recent = recentIds.map((id) => byId.get(id)).filter((f): f is Food => !!f);
    const recentSet = new Set(recent.map((f) => f.id));
    return [
      ...recent.map((f) => ({ ...f, category: 'Zuletzt verwendet' })),
      ...allFoods.filter((f) => !recentSet.has(f.id)),
    ];
  }, [query, allFoods, recentIds]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Suchen, z. B. Banane, Skyr, Pizza …"
          placeholderTextColor={t.muted}
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
        />
      </View>
      <FlatList
        data={list}
        keyExtractor={(f, i) => `${f.id}-${i}`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ListEmptyComponent={
          <Text style={{ color: t.muted, textAlign: 'center', marginTop: 32 }}>
            Nichts gefunden. Über „Manuell“ kannst du eigene Lebensmittel anlegen.
          </Text>
        }
        renderItem={({ item, index }) => {
          const showHeader = !query && (index === 0 || list[index - 1].category !== item.category);
          return (
            <View>
              {showHeader && <Text style={[styles.catHeader, { color: t.muted }]}>{item.category}</Text>}
              <Pressable
                onPress={() => onSelect(item)}
                onLongPress={
                  item.custom
                    ? () =>
                        Alert.alert('Eigenes Lebensmittel löschen?', item.name, [
                          { text: 'Abbrechen', style: 'cancel' },
                          { text: 'Löschen', style: 'destructive', onPress: () => removeCustomFood(item.id) },
                        ])
                    : undefined
                }
                style={({ pressed }) => [
                  styles.foodRow,
                  { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15 }}>
                    {item.name}
                    {item.custom ? '  ⭐️' : ''}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                    100 g: E {dec(item.protein)} · K {dec(item.carbs)} · F {dec(item.fat)}
                  </Text>
                </View>
                <Text style={{ color: t.text, fontWeight: '600' }}>{fmt(item.kcal)} kcal</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

function PortionForm({ food, date, meal, onBack }: { food: Food; date: string; meal: MealId; onBack: () => void }) {
  const t = useTheme();
  const { addEntry } = useStore();
  const [gramsText, setGramsText] = useState(String(food.portion?.grams ?? 100));
  const grams = parseNum(gramsText);
  const valid = grams > 0 && grams < 10000;
  const n = scale(food, valid ? grams : 0);

  const presets = [
    ...(food.portion ? [{ label: `${food.portion.label} (${food.portion.grams} g)`, grams: food.portion.grams }] : []),
    ...[50, 100, 200].filter((g) => g !== food.portion?.grams).map((g) => ({ label: `${g} g`, grams: g })),
  ];

  const submit = () => {
    if (!valid) return;
    addEntry({ ...entryFromFood(food, grams), date, meal });
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={{ color: t.primary, fontWeight: '600' }}>‹ Zurück zur Suche</Text>
      </Pressable>
      <Card style={{ gap: 14 }}>
        <View>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>{food.name}</Text>
          <Text style={{ color: t.muted, marginTop: 2 }}>
            {food.category} · {fmt(food.kcal)} kcal pro 100 g
          </Text>
        </View>
        <Field
          label="Menge"
          suffix="g"
          value={gramsText}
          onChangeText={setGramsText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <View style={styles.chipsWrap}>
          {presets.map((p) => (
            <Chip key={p.label} label={p.label} selected={grams === p.grams} onPress={() => setGramsText(String(p.grams))} />
          ))}
        </View>
        <View style={styles.nutriRow}>
          <Nutri label="kcal" value={fmt(n.kcal)} color={t.primary} />
          <Nutri label="Eiweiß" value={`${dec(n.protein)} g`} color={t.protein} />
          <Nutri label="Kohlenh." value={`${dec(n.carbs)} g`} color={t.carbs} />
          <Nutri label="Fett" value={`${dec(n.fat)} g`} color={t.fat} />
        </View>
      </Card>
      <Button title={`Zu ${MEALS.find((m) => m.id === meal)?.label} hinzufügen`} onPress={submit} disabled={!valid} />
    </ScrollView>
  );
}

function ManualForm({ date, meal }: { date: string; meal: MealId }) {
  const t = useTheme();
  const { addEntry, addCustomFood } = useStore();
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [save, setSave] = useState(false);

  const num = (s: string) => {
    const v = parseNum(s);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const g = num(grams);
  const k = parseNum(kcal);
  const valid = name.trim().length > 0 && k >= 0 && (!save || g > 0);

  const submit = () => {
    if (!valid) return;
    const totals = { kcal: Math.round(k), protein: num(protein), carbs: num(carbs), fat: num(fat) };
    let foodId: string | undefined;
    if (save) {
      const f = 100 / g;
      const food = addCustomFood({
        name: name.trim(),
        category: 'Meine Lebensmittel',
        kcal: Math.round(totals.kcal * f),
        protein: round1(totals.protein * f),
        carbs: round1(totals.carbs * f),
        fat: round1(totals.fat * f),
        portion: { label: '1 Portion', grams: g },
      });
      foodId = food.id;
    }
    addEntry({ ...totals, name: name.trim(), grams: g > 0 ? g : undefined, foodId, date, meal });
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <Field label="Bezeichnung" value={name} onChangeText={setName} placeholder="z. B. Omas Gulasch" />
        <View style={styles.row}>
          <Field label="Menge (optional)" suffix="g" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" />
          <Field label="Kalorien" suffix="kcal" value={kcal} onChangeText={setKcal} keyboardType="decimal-pad" />
        </View>
        <View style={styles.row}>
          <Field label="Eiweiß" suffix="g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
          <Field label="Kohlenh." suffix="g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
          <Field label="Fett" suffix="g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        </View>
        <View style={[styles.row, { alignItems: 'center' }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>In „Meine Lebensmittel“ speichern</Text>
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
              Benötigt eine Mengenangabe, damit die Werte pro 100 g berechnet werden können.
            </Text>
          </View>
          <Switch value={save} onValueChange={setSave} trackColor={{ true: t.primary }} />
        </View>
      </Card>
      <Button title="Hinzufügen" onPress={submit} disabled={!valid} />
    </ScrollView>
  );
}

function Nutri({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const dec = (n: number) => round1(n).toLocaleString('de-DE');

const styles = StyleSheet.create({
  top: { paddingTop: 12, gap: 12, paddingBottom: 12 },
  chips: { gap: 8, paddingHorizontal: 16 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 12, padding: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  catHeader: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 14, marginBottom: 6 },
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  nutriRow: { flexDirection: 'row' },
  row: { flexDirection: 'row', gap: 10 },
});
