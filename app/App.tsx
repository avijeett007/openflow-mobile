import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/** OpenFlow brand violet. */
const OPENFLOW_VIOLET = '#7C5CFF';

/**
 * Placeholder Home screen. The C2 app agent replaces this with the settings +
 * record flow and deep-link handler (openflow://dictate).
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.wordmark}>OpenFlow</Text>
      <Text style={styles.subtitle}>setup coming</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0B0F',
  },
  wordmark: {
    color: OPENFLOW_VIOLET,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#9A9AA5',
    fontSize: 16,
    marginTop: 8,
  },
});
