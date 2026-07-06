import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { DictionaryEntry } from '@openflow/shared';
import { DictionaryScreenView } from './DictionaryScreen';
import { strings } from '../strings';

function entry(word: string, over: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return { word, sounds_like: [], replace_exact: false, case_sensitive: false, ...over };
}

function renderScreen(
  over: { entries?: DictionaryEntry[]; getEntries?: () => DictionaryEntry[] } = {},
) {
  const persist = jest.fn();
  const onBack = jest.fn();
  const readClipboard = jest.fn(async () => '');
  const writeClipboard = jest.fn(async (_text: string) => undefined);
  const entries = over.entries ?? [];
  const getEntries = over.getEntries ?? (() => entries);
  const utils = render(
    <DictionaryScreenView
      entries={entries}
      getEntries={getEntries}
      persist={persist}
      onBack={onBack}
      readClipboard={readClipboard}
      writeClipboard={writeClipboard}
    />,
  );
  return { ...utils, persist, onBack, readClipboard, writeClipboard };
}

describe('DictionaryScreenView', () => {
  it('shows the explainer and empty state with no entries', () => {
    const { getByText } = renderScreen();
    expect(getByText(strings.dictionary.explainer)).toBeTruthy();
    expect(getByText(strings.dictionary.empty)).toBeTruthy();
  });

  it('adds a word with aliases via the form', () => {
    const { getByPlaceholderText, getByText, persist } = renderScreen();
    fireEvent.changeText(getByPlaceholderText(strings.dictionary.wordPlaceholder), 'MacBook Pro');
    fireEvent.changeText(
      getByPlaceholderText(strings.dictionary.aliasesPlaceholder),
      'mac book pro, macbook',
    );
    fireEvent.press(getByText(strings.dictionary.add));
    expect(persist).toHaveBeenCalledWith([
      entry('MacBook Pro', { sounds_like: ['mac book pro', 'macbook'] }),
    ]);
  });

  it('blocks an empty word with user-visible feedback', () => {
    const { getByText, persist } = renderScreen();
    fireEvent.press(getByText(strings.dictionary.add));
    expect(getByText(strings.dictionary.emptyWordError)).toBeTruthy();
    expect(persist).not.toHaveBeenCalled();
  });

  it('blocks a case-insensitive duplicate word with user-visible feedback', () => {
    const { getByPlaceholderText, getByText, persist } = renderScreen({
      entries: [entry('ChargeBee')],
    });
    fireEvent.changeText(getByPlaceholderText(strings.dictionary.wordPlaceholder), 'chargebee');
    fireEvent.press(getByText(strings.dictionary.add));
    expect(getByText(strings.dictionary.duplicateWordError)).toBeTruthy();
    expect(persist).not.toHaveBeenCalled();
  });

  it('renders each entry with its alias chips and a word-count header', () => {
    const { getByText } = renderScreen({
      entries: [entry('ChargeBee', { sounds_like: ['charge bee'] }), entry('Kubernetes')],
    });
    expect(getByText(strings.dictionary.countFmt(2))).toBeTruthy();
    expect(getByText('ChargeBee')).toBeTruthy();
    expect(getByText('charge bee')).toBeTruthy();
    expect(getByText('Kubernetes')).toBeTruthy();
    expect(getByText(strings.dictionary.noAliases)).toBeTruthy();
  });

  it('expands a row to reveal the toggles + delete, and deletes it', () => {
    const { getByLabelText, getByText, persist } = renderScreen({
      entries: [entry('ChargeBee')],
    });
    fireEvent.press(getByLabelText(`ChargeBee — ${strings.dictionary.options}`));
    expect(getByText(strings.dictionary.matchCapitalization)).toBeTruthy();
    expect(getByText(strings.dictionary.exactOnly)).toBeTruthy();
    fireEvent.press(getByText(strings.dictionary.delete));
    expect(persist).toHaveBeenCalledWith([]);
  });

  it('toggling case_sensitive persists the patched entry', () => {
    const { getByLabelText, getByText, persist } = renderScreen({
      entries: [entry('ChargeBee')],
    });
    fireEvent.press(getByLabelText(`ChargeBee — ${strings.dictionary.options}`));
    fireEvent.press(getByText(strings.dictionary.matchCapitalization));
    expect(persist).toHaveBeenCalledWith([entry('ChargeBee', { case_sensitive: true })]);
  });

  it('imports a pasted word list and merges it (imported wins), then reports the count', () => {
    const { getByPlaceholderText, getByText, persist } = renderScreen({
      entries: [entry('ChargeBee', { sounds_like: ['charge b'] })],
    });
    fireEvent.changeText(
      getByPlaceholderText(strings.dictionary.importPlaceholder),
      'chargebee, Kubernetes',
    );
    fireEvent.press(getByText(strings.dictionary.importButton));
    expect(persist).toHaveBeenCalledWith([entry('chargebee'), entry('Kubernetes')]);
    expect(getByText(strings.dictionary.importedFmt(2, 0))).toBeTruthy();
  });

  it('pastes clipboard content into the import field', async () => {
    const { getByPlaceholderText, getByText, readClipboard } = renderScreen();
    readClipboard.mockResolvedValueOnce('Kubernetes\nMySQL');
    fireEvent.press(getByText(strings.dictionary.pasteFromClipboard));
    await waitFor(() =>
      expect(getByPlaceholderText(strings.dictionary.importPlaceholder).props.value).toBe(
        'Kubernetes\nMySQL',
      ),
    );
  });

  it('exports entries as JSON to the clipboard', async () => {
    const { getByText, writeClipboard } = renderScreen({ entries: [entry('ChargeBee')] });
    fireEvent.press(getByText(strings.dictionary.exportButton));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalled());
    const payload = writeClipboard.mock.calls[0]?.[0] as string;
    expect(JSON.parse(payload)).toEqual([entry('ChargeBee')]);
    expect(await getByText(strings.dictionary.exportedConfirmation)).toBeTruthy();
  });

  it('shows a message instead of exporting when the dictionary is empty', () => {
    const { getByText, writeClipboard } = renderScreen();
    fireEvent.press(getByText(strings.dictionary.exportButton));
    expect(getByText(strings.dictionary.exportEmpty)).toBeTruthy();
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('calls onBack when the back button is pressed', () => {
    const { getByText, onBack } = renderScreen();
    fireEvent.press(getByText(strings.common.back));
    expect(onBack).toHaveBeenCalled();
  });

  // ---- Rapid-edit race: mutations must read a fresh snapshot, not the ------
  // ---- possibly-stale `entries` render prop. ------------------------------

  it('onAdd derives its mutation from getEntries(), not the stale rendered entries prop', () => {
    // Simulate a rapid double-tap: the rendered `entries` prop is still the old
    // (empty) snapshot, but a fresh mutation already landed in getEntries().
    const fresh: DictionaryEntry[] = [entry('ChargeBee')];
    const { getByPlaceholderText, getByText, persist } = renderScreen({
      entries: [],
      getEntries: () => fresh,
    });
    fireEvent.changeText(getByPlaceholderText(strings.dictionary.wordPlaceholder), 'Kubernetes');
    fireEvent.press(getByText(strings.dictionary.add));
    expect(persist).toHaveBeenCalledWith([entry('ChargeBee'), entry('Kubernetes')]);
  });

  it('onDelete derives its mutation from getEntries(), not the stale rendered entries prop', () => {
    const fresh: DictionaryEntry[] = [entry('ChargeBee'), entry('Kubernetes')];
    const { getByLabelText, getByText, persist } = renderScreen({
      entries: [entry('ChargeBee')],
      getEntries: () => fresh,
    });
    fireEvent.press(getByLabelText(`ChargeBee — ${strings.dictionary.options}`));
    fireEvent.press(getByText(strings.dictionary.delete));
    expect(persist).toHaveBeenCalledWith([entry('Kubernetes')]);
  });

  it('onToggleFlag derives its mutation from getEntries(), not the stale rendered entries prop', () => {
    const fresh: DictionaryEntry[] = [entry('ChargeBee'), entry('Kubernetes')];
    const { getByLabelText, getByText, persist } = renderScreen({
      entries: [entry('ChargeBee')],
      getEntries: () => fresh,
    });
    fireEvent.press(getByLabelText(`ChargeBee — ${strings.dictionary.options}`));
    fireEvent.press(getByText(strings.dictionary.matchCapitalization));
    expect(persist).toHaveBeenCalledWith([
      entry('ChargeBee', { case_sensitive: true }),
      entry('Kubernetes'),
    ]);
  });
});
