import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import {
  NavigationContainer,
  DarkTheme,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider, useAppState } from './context/AppState';
import { MainTabs } from './navigation/MainTabs';
import { OnboardingFlow } from './screens/onboarding/OnboardingFlow';
import { HopScreen } from './screens/HopScreen';
import { colors } from './theme';

/** react-navigation dark theme tuned to the OpenFlow palette. */
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    primary: colors.violet,
    border: colors.border,
  },
};

/** Tab routes MainTabs registers — used to type the navigation ref below. */
type RootTabsParamList = {
  Dictate: undefined;
  History: undefined;
  Settings: undefined;
  About: undefined;
};

/**
 * A launch deep link. The iOS keyboard opens `openflow://dictate?rid=<uuid>`
 * (the full-screen hop). The Android IME (C4) opens the app to route to Settings
 * or to request the mic permission — it fires an `openflow.route` launcher-intent
 * extra; when that route is surfaced as a URL (`openflow://settings` /
 * `openflow://mic-permission`) we handle it here too. See NOTE below.
 */
type DeepLink =
  | { kind: 'dictate'; rid: string }
  | { kind: 'settings' }
  | { kind: 'mic-permission' };

/** Parse the current deep link, if any. */
function useDeepLink(): DeepLink | null {
  const url = Linking.useURL();
  return useMemo(() => {
    if (!url) return null;
    try {
      const { hostname, path, queryParams } = Linking.parse(url);
      const route = hostname ?? path; // scheme://dictate → hostname='dictate'
      if (route === 'dictate') {
        const rid = queryParams?.rid;
        return typeof rid === 'string' && rid.length > 0 ? { kind: 'dictate', rid } : null;
      }
      if (route === 'settings') return { kind: 'settings' };
      if (route === 'mic-permission') return { kind: 'mic-permission' };
      return null;
    } catch {
      return null;
    }
  }, [url]);
}

function Root(): React.ReactElement {
  const { ready, onboarded } = useAppState();
  const link = useDeepLink();
  const [closedRid, setClosedRid] = useState<string | null>(null);
  const navRef = useNavigationContainerRef<RootTabsParamList>();

  const hopRid = link?.kind === 'dictate' ? link.rid : null;

  // Android IME launch routes: once the navigator is mounted, jump to the
  // Settings tab or the mic-permission-requesting screen (the Dictate tab
  // triggers the RECORD_AUDIO prompt on record). Before onboarding, MainTabs is
  // not mounted — the onboarding flow already opens on the permission step, so
  // no navigation is needed there.
  useEffect(() => {
    if (!ready || !onboarded || !link) return;
    if (link.kind === 'settings' && navRef.isReady()) navRef.navigate('Settings');
    else if (link.kind === 'mic-permission' && navRef.isReady()) navRef.navigate('Dictate');
  }, [ready, onboarded, link, navRef]);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.violet} />
      </View>
    );
  }

  // A live hop deep-link takes over the whole screen (iOS keyboard flow).
  if (hopRid && hopRid !== closedRid) {
    return <HopScreen rid={hopRid} onClose={() => setClosedRid(hopRid)} />;
  }

  return (
    <NavigationContainer ref={navRef} theme={navTheme}>
      {onboarded ? <MainTabs /> : <OnboardingFlow />}
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppStateProvider>
        <Root />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
