import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F6F5',
  card: '#FFFFFF',
  text: '#16201B',
  muted: '#6B7570',
  border: '#E2E7E4',
  primary: '#1F9D63',
  primarySoft: '#DDF3E8',
  onPrimary: '#FFFFFF',
  danger: '#D64545',
  track: '#E7ECE9',
  protein: '#3B82F6',
  carbs: '#F59E0B',
  fat: '#EC4899',
  water: '#0EA5E9',
  over: '#E25C3B',
};

const dark: typeof light = {
  bg: '#0E1311',
  card: '#18201C',
  text: '#ECF2EE',
  muted: '#93A098',
  border: '#27322C',
  primary: '#34C17F',
  primarySoft: '#173A2A',
  onPrimary: '#06130C',
  danger: '#F06A6A',
  track: '#26302B',
  protein: '#60A5FA',
  carbs: '#FBBF24',
  fat: '#F472B6',
  water: '#38BDF8',
  over: '#F27A5C',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
