import type { Entry, Food, Goals, GoalType, Nutrients, Profile } from './types';

export const ACTIVITY_LEVELS: { value: number; label: string; hint: string }[] = [
  { value: 1.2, label: 'Kaum aktiv', hint: 'Bürojob, wenig Bewegung' },
  { value: 1.375, label: 'Leicht aktiv', hint: '1–3× Sport pro Woche' },
  { value: 1.55, label: 'Aktiv', hint: '3–5× Sport pro Woche' },
  { value: 1.725, label: 'Sehr aktiv', hint: '6–7× Sport pro Woche' },
  { value: 1.9, label: 'Extrem aktiv', hint: 'Körperliche Arbeit + Sport' },
];

export const GOAL_TYPES: { value: GoalType; label: string; delta: number }[] = [
  { value: 'lose', label: 'Abnehmen', delta: -500 },
  { value: 'maintain', label: 'Gewicht halten', delta: 0 },
  { value: 'gain', label: 'Zunehmen', delta: 300 },
];

export const DEFAULT_PROFILE: Profile = {
  sex: 'female',
  age: 30,
  heightCm: 170,
  weightKg: 70,
  activity: 1.375,
  goal: 'maintain',
};

/** Grundumsatz nach Mifflin-St Jeor. */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

export function tdee(p: Profile): number {
  return bmr(p) * p.activity;
}

export function calculatedKcal(p: Profile): number {
  const delta = GOAL_TYPES.find((g) => g.value === p.goal)?.delta ?? 0;
  return Math.max(1200, Math.round((tdee(p) + delta) / 10) * 10);
}

export function goalsFor(p: Profile): Goals {
  const kcal = p.customKcal && p.customKcal > 0 ? p.customKcal : calculatedKcal(p);
  // Protein: 1,8 g/kg (max. 35 % der Energie), Fett: 30 %, Rest Kohlenhydrate
  const protein = Math.min(1.8 * p.weightKg, (kcal * 0.35) / 4);
  const fat = (kcal * 0.3) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { kcal, protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

export function scale(food: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  return {
    kcal: Math.round(food.kcal * f),
    protein: round1(food.protein * f),
    carbs: round1(food.carbs * f),
    fat: round1(food.fat * f),
  };
}

export function sum(entries: Nutrients[]): Nutrients {
  return entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('de-DE');
}

export function parseNum(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function entryFromFood(food: Food, grams: number): Omit<Entry, 'id' | 'date' | 'meal' | 'createdAt'> {
  return { name: food.name, grams, foodId: food.id, ...scale(food, grams) };
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}
