import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, Field, SectionTitle } from '@/components/ui';
import { ACTIVITY_LEVELS, DEFAULT_PROFILE, GOAL_TYPES, bmr, calculatedKcal, fmt, goalsFor, parseNum, tdee } from '@/lib/nutrition';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import type { GoalType, Profile, Sex } from '@/lib/types';

export default function ProfileScreen() {
  const t = useTheme();
  const { profile, setProfile, resetAll, onboarded } = useStore();

  const [sex, setSex] = useState<Sex>(profile.sex);
  const [age, setAge] = useState(String(profile.age));
  const [height, setHeight] = useState(String(profile.heightCm));
  const [weight, setWeight] = useState(String(profile.weightKg).replace('.', ','));
  const [activity, setActivity] = useState(profile.activity);
  const [goal, setGoal] = useState<GoalType>(profile.goal);
  const [custom, setCustom] = useState(profile.customKcal ? String(profile.customKcal) : '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(false);
  }, [sex, age, height, weight, activity, goal, custom]);

  const draft: Profile = {
    sex,
    age: parseNum(age),
    heightCm: parseNum(height),
    weightKg: parseNum(weight),
    activity,
    goal,
    customKcal: custom.trim() ? Math.round(parseNum(custom)) : undefined,
  };
  const valid =
    draft.age >= 10 &&
    draft.age <= 110 &&
    draft.heightCm >= 100 &&
    draft.heightCm <= 250 &&
    draft.weightKg >= 30 &&
    draft.weightKg <= 300 &&
    (draft.customKcal === undefined || (draft.customKcal >= 800 && draft.customKcal <= 8000));
  const goals = valid ? goalsFor(draft) : null;

  const save = () => {
    if (!valid) return;
    setProfile(draft);
    setSaved(true);
  };

  const confirmReset = () =>
    Alert.alert('Alle Daten löschen?', 'Tagebuch, eigene Lebensmittel und Profil werden unwiderruflich gelöscht.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          resetAll();
          setSex(DEFAULT_PROFILE.sex);
          setAge(String(DEFAULT_PROFILE.age));
          setHeight(String(DEFAULT_PROFILE.heightCm));
          setWeight(String(DEFAULT_PROFILE.weightKg));
          setActivity(DEFAULT_PROFILE.activity);
          setGoal(DEFAULT_PROFILE.goal);
          setCustom('');
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <SectionTitle>Über dich</SectionTitle>
        <View style={styles.row}>
          <Chip label="Weiblich" selected={sex === 'female'} onPress={() => setSex('female')} />
          <Chip label="Männlich" selected={sex === 'male'} onPress={() => setSex('male')} />
        </View>
        <View style={styles.row}>
          <Field label="Alter" suffix="J." value={age} onChangeText={setAge} keyboardType="number-pad" />
          <Field label="Größe" suffix="cm" value={height} onChangeText={setHeight} keyboardType="number-pad" />
          <Field label="Gewicht" suffix="kg" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        </View>
      </Card>

      <Card style={{ gap: 8 }}>
        <SectionTitle>Aktivität</SectionTitle>
        {ACTIVITY_LEVELS.map((a) => {
          const sel = activity === a.value;
          return (
            <Pressable
              key={a.value}
              onPress={() => setActivity(a.value)}
              style={[styles.option, { borderColor: sel ? t.primary : t.border, backgroundColor: sel ? t.primarySoft : 'transparent' }]}
            >
              <Text style={{ color: t.text, fontWeight: sel ? '700' : '500' }}>{a.label}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{a.hint}</Text>
            </Pressable>
          );
        })}
      </Card>

      <Card style={{ gap: 12 }}>
        <SectionTitle>Ziel</SectionTitle>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {GOAL_TYPES.map((g) => (
            <Chip key={g.value} label={g.label} selected={goal === g.value} onPress={() => setGoal(g.value)} />
          ))}
        </View>
        <Field
          label="Eigenes Kalorienziel (optional)"
          suffix="kcal"
          value={custom}
          onChangeText={setCustom}
          keyboardType="number-pad"
          placeholder={valid ? fmt(calculatedKcal(draft)) : ''}
        />
      </Card>

      <Card style={{ gap: 10 }}>
        <SectionTitle>Dein Tagesbedarf</SectionTitle>
        {goals ? (
          <>
            <Row label="Grundumsatz" value={`${fmt(bmr(draft))} kcal`} />
            <Row label="Gesamtumsatz" value={`${fmt(tdee(draft))} kcal`} />
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            <Row label="Tagesziel" value={`${fmt(goals.kcal)} kcal`} strong />
            <Row label="Eiweiß" value={`${goals.protein} g`} color={t.protein} />
            <Row label="Kohlenhydrate" value={`${goals.carbs} g`} color={t.carbs} />
            <Row label="Fett" value={`${goals.fat} g`} color={t.fat} />
          </>
        ) : (
          <Text style={{ color: t.danger }}>Bitte prüfe deine Angaben (Alter, Größe, Gewicht, Kalorienziel).</Text>
        )}
        <Text style={{ color: t.muted, fontSize: 12 }}>
          Berechnung nach Mifflin-St Jeor. Richtwerte – keine medizinische Beratung.
        </Text>
      </Card>

      <Button title={saved ? '✓ Gespeichert' : onboarded ? 'Speichern' : 'Ziel festlegen'} onPress={save} disabled={!valid} />
      <Button title="Alle Daten löschen" variant="danger" onPress={confirmReset} />
    </ScrollView>
  );
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: color ?? t.muted, fontWeight: strong ? '700' : '500' }}>{label}</Text>
      <Text style={{ color: t.text, fontWeight: strong ? '800' : '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 10 },
  option: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
