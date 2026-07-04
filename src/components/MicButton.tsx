import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import type { DictationStatus } from '../hooks/useDictation';

/**
 * Big tap-to-talk mic button. Idle → violet; recording → red pulse ring;
 * transcribing/cleaning → spinner; disabled while busy processing.
 */
export function MicButton({
  status,
  onPress,
  disabled,
}: {
  status: DictationStatus;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const recording = status === 'recording';
  const busy = status === 'transcribing' || status === 'cleaning';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
      accessibilityState={{ disabled: !!disabled || busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.wrap, pressed && !busy && styles.pressed]}
    >
      {recording ? <View style={styles.ring} /> : null}
      <View style={[styles.circle, recording && styles.circleRecording, busy && styles.circleBusy]}>
        {busy ? (
          <ActivityIndicator color={colors.white} size="large" />
        ) : (
          <Text style={styles.glyph}>{recording ? '■' : '🎙'}</Text>
        )}
      </View>
    </Pressable>
  );
}

const SIZE = 160;

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.danger,
    opacity: 0.5,
  },
  circle: {
    width: SIZE - 28,
    height: SIZE - 28,
    borderRadius: radius.pill,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.violet,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  circleRecording: { backgroundColor: colors.danger, shadowColor: colors.danger },
  circleBusy: { backgroundColor: colors.violetDim },
  glyph: { fontSize: 52, color: colors.white },
});
