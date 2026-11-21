import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { FOODS } from './foods';
import { DEFAULT_PROFILE, goalsFor } from './nutrition';
import type { Entry, Food, Goals, Profile } from './types';

const STORAGE_KEY = 'kalorien-app/v1';

type PersistedState = {
  entries: Entry[];
  customFoods: Food[];
  profile: Profile;
  waterByDate: Record<string, number>;
  onboarded: boolean;
};

const INITIAL: PersistedState = {
  entries: [],
  customFoods: [],
  profile: DEFAULT_PROFILE,
  waterByDate: {},
  onboarded: false,
};

type Store = PersistedState & {
  ready: boolean;
  goals: Goals;
  allFoods: Food[];
  addEntry: (e: Omit<Entry, 'id' | 'createdAt'>) => void;
  updateEntry: (id: string, patch: Partial<Entry>) => void;
  removeEntry: (id: string) => void;
  addCustomFood: (f: Omit<Food, 'id' | 'custom'>) => Food;
  removeCustomFood: (id: string) => void;
  setProfile: (p: Profile) => void;
  setWater: (date: string, glasses: number) => void;
  resetAll: () => void;
};

const StoreContext = createContext<Store | null>(null);

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(INITIAL);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedState>;
          setState({ ...INITIAL, ...parsed, profile: { ...DEFAULT_PROFILE, ...parsed.profile } });
        }
      })
      .catch((err) => console.warn('Daten konnten nicht geladen werden', err))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((err) =>
        console.warn('Daten konnten nicht gespeichert werden', err)
      );
    }, 250);
  }, [state, ready]);

  const addEntry = useCallback<Store['addEntry']>((e) => {
    setState((s) => ({ ...s, entries: [...s.entries, { ...e, id: uid(), createdAt: Date.now() }] }));
  }, []);

  const updateEntry = useCallback<Store['updateEntry']>((id, patch) => {
    setState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }, []);

  const removeEntry = useCallback<Store['removeEntry']>((id) => {
    setState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
  }, []);

  const addCustomFood = useCallback<Store['addCustomFood']>((f) => {
    const food: Food = { ...f, id: `custom-${uid()}`, custom: true };
    setState((s) => ({ ...s, customFoods: [food, ...s.customFoods] }));
    return food;
  }, []);

  const removeCustomFood = useCallback<Store['removeCustomFood']>((id) => {
    setState((s) => ({ ...s, customFoods: s.customFoods.filter((f) => f.id !== id) }));
  }, []);

  const setProfile = useCallback<Store['setProfile']>((profile) => {
    setState((s) => ({ ...s, profile, onboarded: true }));
  }, []);

  const setWater = useCallback<Store['setWater']>((date, glasses) => {
    setState((s) => ({ ...s, waterByDate: { ...s.waterByDate, [date]: Math.max(0, glasses) } }));
  }, []);

  const resetAll = useCallback(() => setState(INITIAL), []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      ready,
      goals: goalsFor(state.profile),
      allFoods: [...state.customFoods, ...FOODS],
      addEntry,
      updateEntry,
      removeEntry,
      addCustomFood,
      removeCustomFood,
      setProfile,
      setWater,
      resetAll,
    }),
    [state, ready, addEntry, updateEntry, removeEntry, addCustomFood, removeCustomFood, setProfile, setWater, resetAll]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore muss innerhalb von <StoreProvider> verwendet werden');
  return ctx;
}
