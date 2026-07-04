import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Body, Button } from '../components/ui';
import { MicButton } from '../components/MicButton';
import { Wordmark } from '../components/Wordmark';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDictation } from '../hooks/useAppDictation';
import { hopReducer, initialHopState } from '../state/hopMode';
import { settingsBridge } from '../lib/settingsBridge';
import type { DictationStatus } from '../hooks/useDictation';
import { colors, font, spacing } from '../theme';
import { strings } from '../strings';

/**
 * iOS keyboard "hop" surface. Reached via `openflow://dictate?rid=<uuid>`. Auto
 * starts recording, streams status to the App Group hand-off (so the keyboard's
 * status chip updates), and on completion writes the final `{rid, text|error}`
 * hand-off + a history row, then tells the user to tap "‹ Back" to insert.
 */
export function HopScreen({
  rid,
  onClose,
}: {
  rid: string;
  onClose?: () => void;
}): React.ReactElement {
  const [hop, dispatchHop] = useReducer(hopReducer, rid, initialHopState);

  const onStatus = useCallback(
    (status: DictationStatus) => {
      dispatchHop({ type: 'DICTATION_STATUS', status });
      // Stream intermediate status so the keyboard chip can reflect progress.
      // Terminal states (ready/error) carry text/error and are written in onResult.
      if (status === 'recording' || status === 'transcribing' || status === 'cleaning') {
        void settingsBridge.writeHandoff({ rid, status });
      }
    },
    [rid],
  );

  const onResult = useCallback(
    (result: {
      status: 'ready' | 'error';
      cleanedText?: string;
      rawText?: string;
      error?: string;
    }) => {
      if (result.status === 'ready') {
        const text = result.cleanedText ?? result.rawText ?? '';
        void settingsBridge.writeHandoff({ rid, status: 'ready', text });
        dispatchHop({ type: 'RESULT', ok: true, text });
      } else {
        void settingsBridge.writeHandoff({ rid, status: 'error', error: result.error });
        dispatchHop({ type: 'RESULT', ok: false, error: result.error });
      }
    },
    [rid],
  );

  const { state, start, stop, reset } = useAppDictation({
    appContext: 'keyboard',
    onStatus,
    onResult,
  });

  // Auto-start recording on entry (once).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void start();
    }
  }, [start]);

  const retry = () => {
    reset();
    startedRef.current = true;
    void start();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.top}>
        <Wordmark size={24} />
      </View>

      <View style={styles.center}>
        {hop.phase === 'listening' ? (
          <>
            <MicButton status={state.status} onPress={() => void stop()} />
            <Text style={styles.status}>{strings.hop.listening}</Text>
          </>
        ) : null}

        {hop.phase === 'processing' ? (
          <>
            <ActivityIndicator size="large" color={colors.violet} />
            <Text style={styles.status}>{strings.hop.processing}</Text>
          </>
        ) : null}

        {hop.phase === 'done' ? (
          <>
            <Text style={styles.doneGlyph}>✓</Text>
            <Text style={styles.doneTitle}>{strings.hop.doneTitle}</Text>
            <Body dim style={styles.doneBody}>
              {strings.hop.doneBody}
            </Body>
            {onClose ? (
              <>
                <View style={{ height: spacing.md }} />
                <Button label={strings.common.close} onPress={onClose} variant="ghost" />
              </>
            ) : null}
          </>
        ) : null}

        {hop.phase === 'error' ? (
          <>
            <Text style={styles.errorTitle}>{strings.hop.errorTitle}</Text>
            <Body dim style={styles.doneBody}>
              {hop.error}
            </Body>
            <View style={{ height: spacing.md }} />
            <Button label={strings.hop.retry} onPress={retry} variant="secondary" />
            {onClose ? (
              <Button label={strings.common.close} onPress={onClose} variant="ghost" />
            ) : null}
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { alignItems: 'center', paddingTop: spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  status: { color: colors.textDim, fontSize: font.body, textAlign: 'center' },
  doneGlyph: { color: colors.success, fontSize: 72, fontWeight: '800' },
  doneTitle: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  doneBody: { textAlign: 'center' },
  errorTitle: { color: colors.danger, fontSize: font.title, fontWeight: '800' },
});
