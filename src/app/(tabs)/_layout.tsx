import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useTheme } from '@/lib/theme';

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{icon}</Text>;
}

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.card },
        headerTitleStyle: { color: t.text },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Tagebuch', tabBarIcon: ({ focused }) => <TabIcon icon="📒" focused={focused} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'Verlauf', tabBarIcon: ({ focused }) => <TabIcon icon="📊" focused={focused} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Ziele', tabBarIcon: ({ focused }) => <TabIcon icon="🎯" focused={focused} /> }}
      />
    </Tabs>
  );
}
