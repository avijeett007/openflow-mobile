import React from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import { colors, font } from '../theme';
import { strings } from '../strings';

/**
 * OpenFlow wordmark: violet "Open" + white "Flow". Rendered as a single Text so
 * it wraps as one unit. `size` scales both halves.
 */
export function Wordmark({ size = font.wordmark }: { size?: number }): React.ReactElement {
  const base: TextStyle = { fontSize: size, fontWeight: '800', letterSpacing: 0.5 };
  return (
    <Text style={styles.row} accessibilityRole="header" accessibilityLabel="OpenFlow">
      <Text style={[base, { color: colors.violet }]}>{strings.brand.open}</Text>
      <Text style={[base, { color: colors.white }]}>{strings.brand.flow}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { textAlign: 'center' },
});
