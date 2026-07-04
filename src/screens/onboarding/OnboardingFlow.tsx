import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { type CleanupProvider, type SttProvider } from '@openflow/shared';
import { Body, Button, Choice, Field, Screen, Section, Title, Toggle } from '../../components/ui';
import { Wordmark } from '../../components/Wordmark';
import { useAppState } from '../../context/AppState';
import { setSecret } from '../../lib/secrets';
import {
  testCleanupConnection,
  testSttConnection,
  type TestResult,
} from '../../lib/testConnection';
import { colors, font, spacing } from '../../theme';
import { strings } from '../../strings';

const STT_PROVIDERS: { value: SttProvider; label: string }[] = [
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'custom', label: 'Custom' },
];
const CLEANUP_PROVIDERS: { value: CleanupProvider; label: string }[] = [
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom' },
];

function StepDots({ index }: { index: number }): React.ReactElement {
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

function TestRow({ result }: { result?: TestResult }): React.ReactElement | null {
  if (!result) return null;
  return (
    <Text style={[styles.testLine, { color: result.ok ? colors.success : colors.danger }]}>
      {result.ok ? strings.settings.testPass : strings.settings.testFail}
      {result.detail ? ` — ${result.detail}` : ''}
    </Text>
  );
}

/** Three-step onboarding: welcome → enable keyboard → backend setup. */
export function OnboardingFlow(): React.ReactElement {
  const { settings, updateSettings, completeOnboarding } = useAppState();
  const [step, setStep] = useState(0);

  // Backend draft (step 3).
  const [sttProvider, setSttProvider] = useState<SttProvider>(settings.stt.provider);
  const [cleanupEnabled, setCleanupEnabled] = useState(settings.cleanup.enabled);
  const [cleanupProvider, setCleanupProvider] = useState<CleanupProvider>(
    settings.cleanup.provider,
  );
  const [sttKey, setSttKey] = useState('');
  const [cleanupKey, setCleanupKey] = useState('');
  const [sttTest, setSttTest] = useState<TestResult>();
  const [cleanupTest, setCleanupTest] = useState<TestResult>();
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    await setSecret(settings.stt.apiKeyRef, sttKey);
    await setSecret(settings.cleanup.apiKeyRef, cleanupKey);
    await updateSettings({
      ...settings,
      stt: { ...settings.stt, provider: sttProvider },
      cleanup: { ...settings.cleanup, enabled: cleanupEnabled, provider: cleanupProvider },
    });
    await completeOnboarding();
    // completeOnboarding flips the flag; the app swaps to the main tabs.
  };

  if (step === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Wordmark size={40} />
          <View style={{ height: spacing.lg }} />
          <Title>{strings.onboarding.welcome.title}</Title>
          <Body dim style={{ textAlign: 'center', marginTop: spacing.md }}>
            {strings.onboarding.welcome.body}
          </Body>
        </View>
        <StepDots index={0} />
        <Button label={strings.onboarding.welcome.cta} onPress={() => setStep(1)} />
      </Screen>
    );
  }

  if (step === 1) {
    const isIos = Platform.OS === 'ios';
    const steps = isIos
      ? strings.onboarding.enableKeyboard.iosSteps
      : strings.onboarding.enableKeyboard.androidSteps;
    const privacy = isIos
      ? strings.onboarding.enableKeyboard.iosPrivacy
      : strings.onboarding.enableKeyboard.androidPrivacy;
    return (
      <Screen>
        <Title>{strings.onboarding.enableKeyboard.title}</Title>
        <Section title={isIos ? 'iOS' : 'Android'}>
          {steps.map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Body style={{ flex: 1 }}>{s}</Body>
            </View>
          ))}
        </Section>
        <Section title="Privacy">
          <Body dim>{privacy}</Body>
        </Section>
        <StepDots index={1} />
        <Button label={strings.onboarding.enableKeyboard.cta} onPress={() => setStep(2)} />
        <Button
          label={strings.onboarding.enableKeyboard.skip}
          onPress={() => setStep(2)}
          variant="ghost"
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{strings.onboarding.backend.title}</Title>
      <Body dim>{strings.onboarding.backend.body}</Body>

      <Section title={strings.settings.sttSection}>
        <Choice<SttProvider>
          label={strings.settings.provider}
          value={sttProvider}
          options={STT_PROVIDERS}
          onChange={setSttProvider}
        />
        <Field
          label={strings.settings.apiKey}
          value={sttKey}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={strings.settings.apiKeyPlaceholder}
          onChangeText={setSttKey}
        />
        <Button
          label={strings.onboarding.backend.testStt}
          variant="secondary"
          onPress={async () =>
            setSttTest(await testSttConnection({ ...settings.stt, provider: sttProvider }, sttKey))
          }
        />
        <TestRow result={sttTest} />
      </Section>

      <Section title={strings.settings.cleanupSection}>
        <Toggle
          label={strings.settings.cleanupEnabled}
          value={cleanupEnabled}
          onChange={setCleanupEnabled}
        />
        {cleanupEnabled ? (
          <>
            <Choice<CleanupProvider>
              label={strings.settings.provider}
              value={cleanupProvider}
              options={CLEANUP_PROVIDERS}
              onChange={setCleanupProvider}
            />
            <Field
              label={strings.settings.apiKey}
              value={cleanupKey}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={strings.settings.apiKeyPlaceholder}
              onChangeText={setCleanupKey}
            />
            <Button
              label={strings.onboarding.backend.testCleanup}
              variant="secondary"
              onPress={async () =>
                setCleanupTest(
                  await testCleanupConnection(
                    { ...settings.cleanup, provider: cleanupProvider },
                    cleanupKey,
                    settings.prompts,
                  ),
                )
              }
            />
            <TestRow result={cleanupTest} />
          </>
        ) : null}
      </Section>

      <StepDots index={2} />
      <Button label={strings.onboarding.backend.cta} onPress={finish} loading={busy} />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xxl },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.violet, width: 20 },
  stepRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNum: {
    color: colors.white,
    backgroundColor: colors.violet,
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: 'center',
    lineHeight: 26,
    fontWeight: '800',
    overflow: 'hidden',
  },
  testLine: { fontSize: font.small },
});
