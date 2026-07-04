import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  type CleanupProvider,
  type CleanupSettings,
  type PrivacyMode,
  type Prompt,
  type Settings,
  type SttMode,
  type SttProvider,
  type SttSettings,
} from '@openflow/shared';
import { Body, Button, Choice, Field, Screen, Section, Title, Toggle } from '../components/ui';
import { useAppState } from '../context/AppState';
import { getSecret, setSecret } from '../lib/secrets';
import { testCleanupConnection, testSttConnection, type TestResult } from '../lib/testConnection';
import { colors, font, spacing } from '../theme';
import { strings } from '../strings';

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
const PRIVACY_OPTIONS: { value: PrivacyMode; label: string }[] = [
  { value: 'full', label: strings.privacyModes.full },
  { value: 'keywordsOnly', label: strings.privacyModes.keywordsOnly },
  { value: 'off', label: strings.privacyModes.off },
];

function TestRow({ result }: { result?: TestResult }): React.ReactElement | null {
  if (!result) return null;
  return (
    <Text style={[styles.testLine, { color: result.ok ? colors.success : colors.danger }]}>
      {result.ok ? strings.settings.testPass : strings.settings.testFail}
      {result.detail ? ` — ${result.detail}` : ''}
    </Text>
  );
}

export function SettingsScreen(): React.ReactElement {
  const { settings, updateSettings } = useAppState();
  const [draft, setDraft] = useState<Settings>(settings);
  const [sttKey, setSttKey] = useState('');
  const [cleanupKey, setCleanupKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [sttTest, setSttTest] = useState<TestResult>();
  const [cleanupTest, setCleanupTest] = useState<TestResult>();
  const [sttTesting, setSttTesting] = useState(false);
  const [cleanupTesting, setCleanupTesting] = useState(false);

  // Keep draft in sync if settings load after mount.
  useEffect(() => setDraft(settings), [settings]);

  // Prefill key fields from secure store so the user sees they are set.
  useEffect(() => {
    void (async () => {
      setSttKey((await getSecret(settings.stt.apiKeyRef)) ?? '');
      setCleanupKey((await getSecret(settings.cleanup.apiKeyRef)) ?? '');
    })();
  }, [settings.stt.apiKeyRef, settings.cleanup.apiKeyRef]);

  const patchStt = (patch: Partial<SttSettings>) =>
    setDraft((d) => ({ ...d, stt: { ...d.stt, ...patch } }));
  const patchCleanup = (patch: Partial<CleanupSettings>) =>
    setDraft((d) => ({ ...d, cleanup: { ...d.cleanup, ...patch } }));

  const save = async () => {
    await setSecret(draft.stt.apiKeyRef, sttKey);
    await setSecret(draft.cleanup.apiKeyRef, cleanupKey);
    await updateSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const runSttTest = async () => {
    setSttTesting(true);
    setSttTest(undefined);
    setSttTest(await testSttConnection(draft.stt, sttKey));
    setSttTesting(false);
  };
  const runCleanupTest = async () => {
    setCleanupTesting(true);
    setCleanupTest(undefined);
    setCleanupTest(await testCleanupConnection(draft.cleanup, cleanupKey, draft.prompts));
    setCleanupTesting(false);
  };

  const showSttBaseUrl = draft.stt.provider === 'custom' || draft.stt.mode === 'selfHosted';
  const showCleanupBaseUrl =
    draft.cleanup.provider === 'custom' || draft.cleanup.provider === 'ollama';

  return (
    <Screen>
      <Title>{strings.settings.title}</Title>

      <Section title={strings.settings.sttSection}>
        <Choice<SttMode>
          label={strings.settings.mode}
          value={draft.stt.mode}
          options={[
            { value: 'remote', label: 'Remote' },
            { value: 'selfHosted', label: 'Self-hosted' },
          ]}
          onChange={(mode) => patchStt({ mode })}
        />
        <Choice<SttProvider>
          label={strings.settings.provider}
          value={draft.stt.provider}
          options={STT_PROVIDERS}
          onChange={(provider) => patchStt({ provider })}
        />
        {showSttBaseUrl ? (
          <Field
            label={strings.settings.baseUrl}
            value={draft.stt.baseUrl ?? ''}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://your-endpoint/v1"
            onChangeText={(t) => patchStt({ baseUrl: t.trim() === '' ? undefined : t.trim() })}
          />
        ) : null}
        <Field
          label={strings.settings.model}
          value={draft.stt.model}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(model) => patchStt({ model })}
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
          label={sttTesting ? strings.settings.testing : strings.onboarding.backend.testStt}
          onPress={runSttTest}
          variant="secondary"
          loading={sttTesting}
        />
        <TestRow result={sttTest} />
      </Section>

      <Section title={strings.settings.cleanupSection}>
        <Toggle
          label={strings.settings.cleanupEnabled}
          value={draft.cleanup.enabled}
          onChange={(enabled) => patchCleanup({ enabled })}
        />
        {draft.cleanup.enabled ? (
          <>
            <Choice<CleanupProvider>
              label={strings.settings.provider}
              value={draft.cleanup.provider}
              options={CLEANUP_PROVIDERS}
              onChange={(provider) => patchCleanup({ provider })}
            />
            {showCleanupBaseUrl ? (
              <Field
                label={strings.settings.baseUrl}
                value={draft.cleanup.baseUrl ?? ''}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://localhost:11434/v1"
                onChangeText={(t) =>
                  patchCleanup({ baseUrl: t.trim() === '' ? undefined : t.trim() })
                }
              />
            ) : null}
            <Field
              label={strings.settings.model}
              value={draft.cleanup.model}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(model) => patchCleanup({ model })}
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
            <PromptEditor
              prompts={draft.prompts}
              promptId={draft.cleanup.promptId}
              onSelect={(promptId) => patchCleanup({ promptId })}
              onChangePrompts={(prompts, promptId) =>
                setDraft((d) => ({
                  ...d,
                  prompts,
                  cleanup: { ...d.cleanup, promptId: promptId ?? d.cleanup.promptId },
                }))
              }
            />
            <Button
              label={
                cleanupTesting ? strings.settings.testing : strings.onboarding.backend.testCleanup
              }
              onPress={runCleanupTest}
              variant="secondary"
              loading={cleanupTesting}
            />
            <TestRow result={cleanupTest} />
          </>
        ) : null}
      </Section>

      <Section title={strings.settings.privacySection}>
        <Choice<PrivacyMode>
          label={strings.settings.privacyMode}
          value={draft.privacyMode}
          options={PRIVACY_OPTIONS}
          onChange={(privacyMode) => setDraft((d) => ({ ...d, privacyMode }))}
        />
      </Section>

      <Button label={saved ? strings.settings.saved : strings.settings.save} onPress={save} />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

/** Prompt picker + custom-prompt editor. */
function PromptEditor({
  prompts,
  promptId,
  onSelect,
  onChangePrompts,
}: {
  prompts: Prompt[];
  promptId: string;
  onSelect: (id: string) => void;
  onChangePrompts: (prompts: Prompt[], selectId?: string) => void;
}): React.ReactElement {
  const selected = prompts.find((p) => p.id === promptId) ?? prompts[0];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');

  const isBuiltIn = selected?.id === 'improve-transcription';

  const addPrompt = () => {
    if (name.trim() === '' || text.trim() === '') return;
    const id = `custom-${Date.now().toString(36)}`;
    const next: Prompt = { id, name: name.trim(), prompt: text.trim() };
    onChangePrompts([...prompts, next], id);
    setName('');
    setText('');
    setAdding(false);
  };

  const editSelected = (value: string) => {
    onChangePrompts(
      prompts.map((p) => (p.id === selected.id ? { ...p, prompt: value } : p)),
      selected.id,
    );
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Choice<string>
        label={strings.settings.prompt}
        value={selected?.id ?? ''}
        options={prompts.map((p) => ({ value: p.id, label: p.name }))}
        onChange={onSelect}
      />
      {selected && !isBuiltIn ? (
        <Field
          label={strings.settings.customPrompt}
          value={selected.prompt}
          multiline
          onChangeText={editSelected}
        />
      ) : (
        <Body dim style={{ marginTop: -spacing.xs }}>
          <Text style={styles.builtInNote}>{selected?.prompt}</Text>
        </Body>
      )}
      {adding ? (
        <View style={{ gap: spacing.sm }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="My cleanup style" />
          <Field
            label={strings.settings.customPrompt}
            value={text}
            multiline
            onChangeText={setText}
            placeholder="You are a transcription cleanup assistant…"
          />
          <Button label={strings.settings.addPrompt} onPress={addPrompt} variant="secondary" />
        </View>
      ) : (
        <Button
          label={strings.settings.addPrompt}
          onPress={() => setAdding(true)}
          variant="ghost"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  testLine: { fontSize: font.small },
  builtInNote: { color: colors.textFaint, fontSize: font.tiny },
});
