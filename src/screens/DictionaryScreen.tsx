import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { type DictionaryEntry } from '@openflow/shared';
import { Body, Button, Card, Field, Screen, Section, Title, Toggle } from '../components/ui';
import { useAppState } from '../context/AppState';
import {
  addDictionaryEntry,
  exportDictionaryJson,
  mergeDictionaries,
  parseAliasInput,
  parseImportedDictionary,
  removeDictionaryEntry,
  updateDictionaryEntry,
} from '../lib/dictionaryEditor';
import { colors, font, radius, spacing } from '../theme';
import { strings } from '../strings';

/**
 * Dictionary settings screen (M3a) — custom vocabulary (words/phrases + "sounds
 * like" aliases) that OpenFlow rewrites transcripts to and biases STT/cleanup
 * towards. See @openflow/shared `dictionary/` for the correction engine this
 * feeds; the Kotlin IME reads the same `settings.dictionary` array.
 *
 * `DictionaryScreenView` is the fully dependency-injected, context-free
 * component (unit-testable). The default export wires it to the real settings
 * store + clipboard.
 */

// ---- View (injectable, context-free) --------------------------------------

export interface DictionaryScreenViewProps {
  entries: DictionaryEntry[];
  /**
   * Fresh snapshot of the dictionary at call time. `entries` is a render prop
   * (only as current as the last commit); rapid add/delete/toggle taps that
   * fire before a re-render must NOT derive their mutation from it, or the
   * second mutation would overwrite the first (dropping an edit). Mutations
   * always read `getEntries()` instead, mirroring how `persist` already reads
   * a fresh settings snapshot.
   */
  getEntries: () => DictionaryEntry[];
  persist: (entries: DictionaryEntry[]) => void;
  onBack: () => void;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
}

export function DictionaryScreenView({
  entries,
  getEntries,
  persist,
  onBack,
  readClipboard,
  writeClipboard,
}: DictionaryScreenViewProps): React.ReactElement {
  const [word, setWord] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [importText, setImportText] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const toggleExpanded = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const onAdd = () => {
    const result = addDictionaryEntry(getEntries(), { word, aliases: parseAliasInput(aliasText) });
    if (result.error === 'empty-word') {
      setAddError(strings.dictionary.emptyWordError);
      return;
    }
    if (result.error === 'duplicate-word') {
      setAddError(strings.dictionary.duplicateWordError);
      return;
    }
    setAddError(null);
    persist(result.entries);
    setWord('');
    setAliasText('');
  };

  const onDelete = (index: number) => {
    persist(removeDictionaryEntry(getEntries(), index));
    // Re-index the expanded set so rows after the deleted one stay in sync.
    setExpanded((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  const onToggleFlag = (index: number, key: 'case_sensitive' | 'replace_exact', value: boolean) => {
    persist(updateDictionaryEntry(getEntries(), index, { [key]: value }));
  };

  const onPasteFromClipboard = async () => {
    const text = await readClipboard();
    if (text.trim() === '') {
      setImportMessage(strings.dictionary.clipboardEmpty);
      return;
    }
    setImportText(text);
    setImportMessage(null);
  };

  const onImport = () => {
    if (importText.trim() === '') {
      setImportMessage(strings.dictionary.importEmpty);
      return;
    }
    const { entries: parsed, skipped } = parseImportedDictionary(importText);
    if (parsed.length === 0) {
      setImportMessage(strings.dictionary.importNothingFound);
      return;
    }
    persist(mergeDictionaries(entries, parsed));
    setImportMessage(strings.dictionary.importedFmt(parsed.length, skipped));
    setImportText('');
  };

  const onExport = async () => {
    if (entries.length === 0) {
      setExportMessage(strings.dictionary.exportEmpty);
      return;
    }
    await writeClipboard(exportDictionaryJson(entries));
    setExportMessage(strings.dictionary.exportedConfirmation);
  };

  return (
    <Screen>
      <Button label={strings.common.back} onPress={onBack} variant="ghost" />
      <Title>{strings.dictionary.title}</Title>
      <Body dim>{strings.dictionary.explainer}</Body>

      <Card>
        <Field
          label={strings.dictionary.wordLabel}
          value={word}
          onChangeText={setWord}
          placeholder={strings.dictionary.wordPlaceholder}
          autoCapitalize="words"
          autoCorrect={false}
        />
        <Field
          label={strings.dictionary.aliasesLabel}
          value={aliasText}
          onChangeText={setAliasText}
          placeholder={strings.dictionary.aliasesPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {addError ? <Text style={styles.errorText}>{addError}</Text> : null}
        <Button label={strings.dictionary.add} onPress={onAdd} />
      </Card>

      {entries.length === 0 ? (
        <Body dim>{strings.dictionary.empty}</Body>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.listTitle}>{strings.dictionary.countFmt(entries.length)}</Text>
          {entries.map((entry, index) => (
            <EntryRow
              key={`${entry.word}-${index}`}
              entry={entry}
              expanded={expanded.has(index)}
              onToggleExpand={() => toggleExpanded(index)}
              onDelete={() => onDelete(index)}
              onToggleFlag={(key, value) => onToggleFlag(index, key, value)}
            />
          ))}
        </View>
      )}

      <Section title={strings.dictionary.importSection}>
        <Body dim>{strings.dictionary.importHint}</Body>
        <Field
          label={strings.dictionary.importFieldLabel}
          value={importText}
          onChangeText={setImportText}
          placeholder={strings.dictionary.importPlaceholder}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label={strings.dictionary.pasteFromClipboard}
          onPress={() => void onPasteFromClipboard()}
          variant="secondary"
        />
        <Button label={strings.dictionary.importButton} onPress={onImport} />
        {importMessage ? <Body dim>{importMessage}</Body> : null}
      </Section>

      <Section title={strings.dictionary.exportSection}>
        <Button
          label={strings.dictionary.exportButton}
          onPress={() => void onExport()}
          variant="secondary"
        />
        {exportMessage ? <Body dim>{exportMessage}</Body> : null}
      </Section>

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

/** One dictionary entry: word + alias chips, with an expandable options row. */
function EntryRow({
  entry,
  expanded,
  onToggleExpand,
  onDelete,
  onToggleFlag,
}: {
  entry: DictionaryEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onToggleFlag: (key: 'case_sensitive' | 'replace_exact', value: boolean) => void;
}): React.ReactElement {
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${entry.word} — ${strings.dictionary.options}`}
        onPress={onToggleExpand}
        style={styles.entryHeader}
      >
        <View style={styles.entryMain}>
          <Text style={styles.entryWord}>{entry.word}</Text>
          {entry.sounds_like.length > 0 ? (
            <View style={styles.chipsRow}>
              {entry.sounds_like.map((alias, i) => (
                <View key={`${alias}-${i}`} style={styles.aliasChip}>
                  <Text style={styles.aliasChipText}>{alias}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noAliases}>{strings.dictionary.noAliases}</Text>
          )}
        </View>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.entryOptions}>
          <Toggle
            label={strings.dictionary.matchCapitalization}
            value={entry.case_sensitive}
            onChange={(v) => onToggleFlag('case_sensitive', v)}
          />
          <Toggle
            label={strings.dictionary.exactOnly}
            value={entry.replace_exact}
            onChange={(v) => onToggleFlag('replace_exact', v)}
          />
          <Button label={strings.dictionary.delete} onPress={onDelete} variant="danger" />
        </View>
      ) : null}
    </Card>
  );
}

// ---- Default export: wire the real settings store + clipboard --------------

export function DictionaryScreen({ onBack }: { onBack: () => void }): React.ReactElement {
  const { settings, updateSettings, getSettings } = useAppState();
  const persist = useCallback(
    (entries: DictionaryEntry[]) => {
      const cur = getSettings();
      void updateSettings({ ...cur, dictionary: entries });
    },
    [getSettings, updateSettings],
  );
  const getEntries = useCallback(() => getSettings().dictionary, [getSettings]);

  return (
    <DictionaryScreenView
      entries={settings.dictionary}
      getEntries={getEntries}
      persist={persist}
      onBack={onBack}
      readClipboard={() => Clipboard.getStringAsync()}
      writeClipboard={async (text) => {
        await Clipboard.setStringAsync(text);
      }}
    />
  );
}

// ---- Styles ----------------------------------------------------------------

const styles = StyleSheet.create({
  errorText: { color: colors.danger, fontSize: font.small },
  listTitle: {
    color: colors.textDim,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  entryMain: { flex: 1, gap: spacing.xs },
  entryWord: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  chevron: { color: colors.textFaint, fontSize: font.body, paddingTop: 2 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  aliasChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  aliasChipText: { color: colors.textDim, fontSize: font.tiny },
  noAliases: { color: colors.textFaint, fontSize: font.tiny, fontStyle: 'italic' },
  entryOptions: { gap: spacing.sm, marginTop: spacing.sm },
});
