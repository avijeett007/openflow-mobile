import { defaultSettings, type Settings } from '@openflow/shared';
import {
  type DictationAction,
  type DictationDeps,
  LOCAL_PERMISSION_ERROR,
  ON_DEVICE_PROVIDER,
  dictationReducer,
  initialDictationState,
  processClip,
  processLocalTranscript,
  startLocalSession,
} from './useDictation';
import type { LocalStt } from '../lib/localStt';
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
    transcribe: jest.fn(async () => ({ text: 'hello world raw', prompted: false })),
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

// ---- Local (on-device) path -----------------------------------------------

function localSettings(overrides: Partial<Settings['cleanup']> = {}): Settings {
  const s = defaultSettings();
  s.stt.mode = 'local';
  s.cleanup = { ...s.cleanup, ...overrides };
  return s;
}

function makeRecognizer(overrides: Partial<LocalStt> = {}): jest.Mocked<LocalStt> {
  return {
    isAvailable: jest.fn(async () => ({ available: true })),
    requestPermission: jest.fn(async () => true),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => ({ transcript: 'hello from device' })),
    cancel: jest.fn(async () => undefined),
    ...overrides,
  } as jest.Mocked<LocalStt>;
}

describe('processLocalTranscript', () => {
  function collectDispatch() {
    const actions: DictationAction[] = [];
    return { actions, dispatch: (a: DictationAction) => actions.push(a) };
  }

  it('cleans the on-device transcript and records sttProvider "on-device"', async () => {
    const { deps, saved } = makeDeps({ settings: localSettings() });
    const { actions, dispatch } = collectDispatch();

    const result = await processLocalTranscript('  hello from device  ', 4200, deps, dispatch, {
      appContext: 'app',
    });

    expect(result.status).toBe('ready');
    expect(result.cleanedText).toBe('Hello, world.');
    // No audio clip is ever uploaded — the shared `transcribe` client is untouched.
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(actions.map((a) => a.type)).toEqual([
      'TRANSCRIBING',
      'TRANSCRIBED',
      'CLEANING',
      'READY',
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      rawText: 'hello from device',
      cleanedText: 'Hello, world.',
      sttProvider: ON_DEVICE_PROVIDER,
      durationMs: 4200,
      appContext: 'app',
    });
  });

  it('skips cleanup when disabled and still records on-device', async () => {
    const { deps, saved } = makeDeps({ settings: localSettings({ enabled: false }) });
    const { actions, dispatch } = collectDispatch();

    await processLocalTranscript('just raw text', 1000, deps, dispatch);

    expect(actions.map((a) => a.type)).toEqual(['TRANSCRIBING', 'TRANSCRIBED', 'READY']);
    expect(deps.cleanTranscript).not.toHaveBeenCalled();
    expect(saved[0].sttProvider).toBe(ON_DEVICE_PROVIDER);
    expect(saved[0].cleanedText).toBeUndefined();
  });
});

describe('startLocalSession', () => {
  function collectDispatch() {
    const actions: DictationAction[] = [];
    return { actions, dispatch: (a: DictationAction) => actions.push(a) };
  }

  it('starts recognition and enters recording when available + permitted', async () => {
    const recognizer = makeRecognizer();
    const { actions, dispatch } = collectDispatch();

    const started = await startLocalSession(recognizer, dispatch);

    expect(started).toBe(true);
    expect(recognizer.start).toHaveBeenCalledTimes(1);
    expect(actions.map((a) => a.type)).toEqual(['RECORD_START']);
  });

  it('surfaces an availability error and does NOT start (no cloud fallback)', async () => {
    const reason = 'On-device dictation is not supported on this device.';
    const recognizer = makeRecognizer({
      isAvailable: jest.fn(async () => ({ available: false, reason })),
    });
    const onError = jest.fn();
    const { actions, dispatch } = collectDispatch();

    const started = await startLocalSession(recognizer, dispatch, { onError });

    expect(started).toBe(false);
    // Critical: recognition never starts — audio is NOT sent anywhere.
    expect(recognizer.start).not.toHaveBeenCalled();
    expect(recognizer.requestPermission).not.toHaveBeenCalled();
    expect(actions).toEqual([{ type: 'ERROR', error: reason }]);
    expect(onError).toHaveBeenCalledWith(reason);
  });

  it('surfaces a permission denial without starting', async () => {
    const recognizer = makeRecognizer({ requestPermission: jest.fn(async () => false) });
    const { actions, dispatch } = collectDispatch();

    const started = await startLocalSession(recognizer, dispatch);

    expect(started).toBe(false);
    expect(recognizer.start).not.toHaveBeenCalled();
    expect(actions).toEqual([{ type: 'ERROR', error: LOCAL_PERMISSION_ERROR }]);
  });

  it('streams interim transcripts as PARTIAL actions', async () => {
    const recognizer = makeRecognizer({
      start: jest.fn(async (opts) => {
        opts?.onPartial?.('hello');
        opts?.onPartial?.('hello world');
      }),
    });
    const { actions, dispatch } = collectDispatch();

    await startLocalSession(recognizer, dispatch);

    expect(actions).toEqual([
      { type: 'PARTIAL', text: 'hello' },
      { type: 'PARTIAL', text: 'hello world' },
      { type: 'RECORD_START' },
    ]);
  });
});
