export type MealId = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: { id: MealId; label: string; icon: string }[] = [
  { id: 'breakfast', label: 'Frühstück', icon: '🥐' },
  { id: 'lunch', label: 'Mittagessen', icon: '🥗' },
  { id: 'dinner', label: 'Abendessen', icon: '🍝' },
  { id: 'snack', label: 'Snacks', icon: '🍎' },
];

export type Nutrients = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** Lebensmittel, Nährwerte jeweils pro 100 g bzw. 100 ml. */
export type Food = Nutrients & {
  id: string;
  name: string;
  category: string;
  portion?: { label: string; grams: number };
  custom?: boolean;
};

export type Entry = Nutrients & {
  id: string;
  date: string; // YYYY-MM-DD (lokal)
  meal: MealId;
  name: string;
  grams?: number;
  foodId?: string;
  createdAt: number;
};

export type Sex = 'male' | 'female';
export type GoalType = 'lose' | 'maintain' | 'gain';

export type Profile = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: number; // PAL-Faktor
  goal: GoalType;
  customKcal?: number; // überschreibt den berechneten Bedarf
};

export type Goals = Nutrients;
