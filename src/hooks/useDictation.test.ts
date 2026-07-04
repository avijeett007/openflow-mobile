import { defaultSettings, type Settings } from '@openflow/shared';
import {
  type DictationAction,
  type DictationDeps,
  dictationReducer,
  initialDictationState,
  processClip,
} from './useDictation';
import type { AppHistoryRecord } from '../lib/historyStore';
import type { RecordedClip } from '../lib/recorder';

const clip: RecordedClip = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'audio/m4a',
  fileName: 'dictation.m4a',
  durationMs: 3000,
};

function makeDeps(overrides: Partial<DictationDeps> & { settings?: Settings } = {}): {
  deps: DictationDeps;
  saved: AppHistoryRecord[];
} {
  const settings = overrides.settings ?? defaultSettings();
  const saved: AppHistoryRecord[] = [];
  const deps: DictationDeps = {
    transcribe: jest.fn(async () => ({ text: 'hello world raw' })),
    cleanTranscript: jest.fn(async () => ({ text: 'Hello, world.' })),
    getSettings: () => settings,
    resolveSecret: jest.fn(async () => 'secret-key'),
    saveHistory: jest.fn(async (r: AppHistoryRecord) => {
      saved.push(r);
    }),
    now: () => 1_700_000_000_000,
    makeId: () => 'test-id',
    ...overrides,
  };
  return { deps, saved };
}

describe('dictationReducer', () => {
  it('RECORD_START enters recording and clears prior cleanupFailed', () => {
    const s = dictationReducer(
      { ...initialDictationState, cleanupFailed: true },
      { type: 'RECORD_START' },
    );
    expect(s.status).toBe('recording');
    expect(s.cleanupFailed).toBe(false);
  });

  it('walks transcribing → transcribed → cleaning → ready', () => {
    let s = dictationReducer(initialDictationState, { type: 'TRANSCRIBING' });
    expect(s.status).toBe('transcribing');
    s = dictationReducer(s, { type: 'TRANSCRIBED', rawText: 'raw' });
    expect(s.rawText).toBe('raw');
    s = dictationReducer(s, { type: 'CLEANING' });
    expect(s.status).toBe('cleaning');
    s = dictationReducer(s, {
      type: 'READY',
      rawText: 'raw',
      cleanedText: 'Clean.',
      cleanupFailed: false,
    });
    expect(s).toMatchObject({ status: 'ready', rawText: 'raw', cleanedText: 'Clean.' });
  });

  it('ERROR records the message and RESET returns to initial', () => {
    const err = dictationReducer(initialDictationState, { type: 'ERROR', error: 'boom' });
    expect(err).toMatchObject({ status: 'error', error: 'boom' });
    expect(dictationReducer(err, { type: 'RESET' })).toEqual(initialDictationState);
  });
});

describe('processClip', () => {
  function collectDispatch() {
    const actions: DictationAction[] = [];
    return { actions, dispatch: (a: DictationAction) => actions.push(a) };
  }

  it('transcribes + cleans on the happy path and writes a full history row', async () => {
    const { deps, saved } = makeDeps();
    const { actions, dispatch } = collectDispatch();

    const result = await processClip(clip, deps, dispatch);

    expect(result.status).toBe('ready');
    expect(result.cleanedText).toBe('Hello, world.');
    expect(result.cleanupFailed).toBe(false);
    expect(actions.map((a) => a.type)).toEqual([
      'TRANSCRIBING',
      'TRANSCRIBED',
      'CLEANING',
      'READY',
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      rawText: 'hello world raw',
      cleanedText: 'Hello, world.',
      cleanupProvider: 'groq',
      wordCount: 2,
      durationMs: 3000,
    });
    expect(saved[0].cleanupFailed).toBeUndefined();
  });

  it('on STT failure emits error and writes NO history row', async () => {
    const { deps, saved } = makeDeps({
      transcribe: jest.fn(async () => {
        throw new Error('401 unauthorized');
      }),
    });
    const { actions, dispatch } = collectDispatch();

    const result = await processClip(clip, deps, dispatch);

    expect(result.status).toBe('error');
    expect(result.error).toContain('401');
    expect(actions.map((a) => a.type)).toEqual(['TRANSCRIBING', 'ERROR']);
    expect(saved).toHaveLength(0);
    expect(deps.cleanTranscript).not.toHaveBeenCalled();
  });

  it('on cleanup failure falls back to raw and flags the row', async () => {
    const { deps, saved } = makeDeps({
      cleanTranscript: jest.fn(async () => {
        throw new Error('cleanup 500');
      }),
    });
    const { actions, dispatch } = collectDispatch();

    const result = await processClip(clip, deps, dispatch);

    expect(result.status).toBe('ready');
    expect(result.cleanupFailed).toBe(true);
    expect(result.cleanedText).toBe('hello world raw');
    const ready = actions.find((a) => a.type === 'READY');
    expect(ready).toMatchObject({ cleanupFailed: true });
    expect(saved).toHaveLength(1);
    expect(saved[0].cleanupFailed).toBe(true);
    expect(saved[0].rawText).toBe('hello world raw');
    expect(saved[0].cleanedText).toBeUndefined();
    expect(saved[0].cleanupProvider).toBeUndefined();
  });

  it('skips cleanup entirely when disabled', async () => {
    const settings = defaultSettings();
    settings.cleanup.enabled = false;
    const { deps, saved } = makeDeps({ settings });
    const { actions, dispatch } = collectDispatch();

    await processClip(clip, deps, dispatch);

    expect(actions.map((a) => a.type)).toEqual(['TRANSCRIBING', 'TRANSCRIBED', 'READY']);
    expect(deps.cleanTranscript).not.toHaveBeenCalled();
    expect(saved[0].cleanedText).toBeUndefined();
    expect(saved[0].cleanupProvider).toBeUndefined();
  });

  it('redacts saved text under keywordsOnly privacy but keeps metadata', async () => {
    const settings = defaultSettings();
    settings.privacyMode = 'keywordsOnly';
    const { deps, saved } = makeDeps({ settings });
    const { dispatch } = collectDispatch();

    const result = await processClip(clip, deps, dispatch);

    // In-memory result still carries text (for the UI); the stored row is redacted.
    expect(result.cleanedText).toBe('Hello, world.');
    expect(saved[0].rawText).toBeUndefined();
    expect(saved[0].cleanedText).toBeUndefined();
    expect(saved[0].wordCount).toBe(2);
    expect(saved[0].privacyMode).toBe('keywordsOnly');
  });
});
