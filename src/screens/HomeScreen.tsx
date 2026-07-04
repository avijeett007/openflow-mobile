import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Body, Button, Card, Screen } from '../components/ui';
import { MicButton } from '../components/MicButton';
import { Wordmark } from '../components/Wordmark';
import { useAppDictation } from '../hooks/useAppDictation';
import { colors, font, spacing } from '../theme';
import { strings } from '../strings';

/**
 * Home / Dictate — the standalone dictation surface. Big mic button records in
 * app, runs STT → cleanup via @openflow/shared, and shows the result with Copy.
 */
export function HomeScreen(): React.ReactElement {
  const { state, start, stop, reset } = useAppDictation({ appContext: 'app' });
  const [copied, setCopied] = useState(false);

  const onMic = () => {
    if (state.status === 'recording') {
      void stop();
    } else {
      setCopied(false);
      void start();
    }
  };

  const resultText = state.cleanedText ?? state.rawText ?? '';

  const copy = async () => {
    await Clipboard.setStringAsync(resultText);
    setCopied(true);
  };

  const statusLine = (() => {
    switch (state.status) {
      case 'recording':
        return strings.home.recording;
      case 'transcribing':
        return strings.home.transcribing;
      case 'cleaning':
        return strings.home.cleaning;
      case 'ready':
        return strings.home.ready;
      case 'error':
        return state.error ?? 'Error';
      default:
        return strings.home.idleHint;
    }
  })();

  return (
    <Screen>
      <View style={styles.header}>
        <Wordmark size={28} />
      </View>

      <View style={styles.micArea}>
        <MicButton status={state.status} onPress={onMic} />
        <Text
          style={[styles.status, state.status === 'error' && { color: colors.danger }]}
          accessibilityLiveRegion="polite"
        >
          {statusLine}
        </Text>
        {state.status === 'recording' && state.partialText ? (
          <Text style={styles.partial}>{state.partialText}</Text>
        ) : null}
      </View>

      {state.status === 'ready' || (state.status === 'error' && state.rawText) ? (
        <Card>
          {state.cleanupFailed ? (
            <Text style={styles.warn}>{strings.home.cleanupFellBack}</Text>
          ) : null}
          {state.cleanedText && !state.cleanupFailed ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>{strings.home.cleaned}</Text>
              <Body>{state.cleanedText}</Body>
            </View>
          ) : null}
          {state.rawText ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>{strings.home.raw}</Text>
              <Body dim={!!state.cleanedText && !state.cleanupFailed}>{state.rawText}</Body>
            </View>
          ) : null}
          <View style={styles.actions}>
            <View style={styles.actionItem}>
              <Button
                label={copied ? strings.home.copied : strings.home.copy}
                onPress={copy}
                variant="primary"
              />
            </View>
            <View style={styles.actionItem}>
              <Button label={strings.home.clear} onPress={reset} variant="secondary" />
            </View>
          </View>
        </Card>
      ) : null}

      {state.status === 'error' && !state.rawText ? (
        <Card>
          <Text style={styles.warn}>{state.error}</Text>
          <Button label={strings.home.retry} onPress={reset} variant="secondary" />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: spacing.sm },
  micArea: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  status: { color: colors.textDim, fontSize: font.body, textAlign: 'center' },
  partial: {
    color: colors.textFaint,
    fontSize: font.small,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: spacing.lg,
  },
  block: { gap: spacing.xs },
  blockLabel: {
    color: colors.textFaint,
    fontSize: font.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  warn: { color: colors.warning, fontSize: font.small },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionItem: { flex: 1 },
});
