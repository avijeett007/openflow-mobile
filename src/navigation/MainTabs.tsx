import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { TranslateScreen } from '../screens/TranslateScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

/** Emoji tab glyphs keep the bundle lean (no icon-font asset needed). */
const ICONS: Record<string, string> = {
  Dictate: '🎙',
  Translate: '🌐',
  History: '🕘',
  Settings: '⚙️',
  About: 'ℹ️',
};

export function MainTabs(): React.ReactElement {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.violet,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIcon: ({ color }) => (
          <Text style={{ fontSize: 18, color }}>{ICONS[route.name] ?? '•'}</Text>
        ),
      })}
    >
      <Tab.Screen name="Dictate" component={HomeScreen} />
      <Tab.Screen name="Translate" component={TranslateScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
      <Tab.Screen name="About" component={AboutScreen} />
    </Tab.Navigator>
  );
}
