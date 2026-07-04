import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
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

/** Parse `openflow://dictate?rid=<uuid>` from the current deep link, if any. */
function useHopRid(): string | null {
  const url = Linking.useURL();
  return useMemo(() => {
    if (!url) return null;
    try {
      const { hostname, path, queryParams } = Linking.parse(url);
      const route = hostname ?? path; // scheme://dictate → hostname='dictate'
      if (route !== 'dictate') return null;
      const rid = queryParams?.rid;
      return typeof rid === 'string' && rid.length > 0 ? rid : null;
    } catch {
      return null;
    }
  }, [url]);
}

function Root(): React.ReactElement {
  const { ready, onboarded } = useAppState();
  const hopRid = useHopRid();
  const [closedRid, setClosedRid] = useState<string | null>(null);

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
    <NavigationContainer theme={navTheme}>
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
