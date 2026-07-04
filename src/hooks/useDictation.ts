import { useCallback, useReducer, useRef } from 'react';
import {
  type HistoryRecord,
  type Settings,
  applyPrivacy,
  cleanTranscript as sharedCleanTranscript,
  countWords,
  transcribe as sharedTranscribe,
} from '@openflow/shared';
import type { DictationRecorder, RecordedClip } from '../lib/recorder';
import type { LocalStt } from '../lib/localStt';
import type { AppHistoryRecord } from '../lib/historyStore';

/** History `sttProvider` value recorded for on-device (local) dictation. */
export const ON_DEVICE_PROVIDER = 'on-device';

/**
 * useDictation — the record → transcribe → cleanup orchestration.
 *
 * The state machine (reducer) and the async runner (`processClip`) are pure and
 * dependency-injected so they unit-test without React Native. The hook at the
 * bottom wires the real recorder / shared clients / stores.
 */

export type DictationStatus =
  'idle' | 'recording' | 'transcribing' | 'cleaning' | 'ready' | 'error';

export interface DictationState {
  status: DictationStatus;
  rawText?: string;
  cleanedText?: string;
  /** Live interim transcript while listening in local (on-device) mode. */
  partialText?: string;
  error?: string;
  /** Cleanup was enabled but failed; we fell back to the raw transcript. */
  cleanupFailed: boolean;
}

export const initialDictationState: DictationState = {
  status: 'idle',
  cleanupFailed: false,
};

export type DictationAction =
  | { type: 'RECORD_START' }
  | { type: 'PARTIAL'; text: string }
  | { type: 'TRANSCRIBING' }
  | { type: 'TRANSCRIBED'; rawText: string }
  | { type: 'CLEANING' }
  | { type: 'READY'; rawText: string; cleanedText: string; cleanupFailed: boolean }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

export function dictationReducer(state: DictationState, action: DictationAction): DictationState {
  switch (action.type) {
    case 'RECORD_START':
      return { status: 'recording', cleanupFailed: false };
    case 'PARTIAL':
      return { ...state, partialText: action.text };
    case 'TRANSCRIBING':
      return { ...state, status: 'transcribing', partialText: undefined, error: undefined };
    case 'TRANSCRIBED':
      return { ...state, rawText: action.rawText };
    case 'CLEANING':
      return { ...state, status: 'cleaning' };
    case 'READY':
      return {
        status: 'ready',
        rawText: action.rawText,
        cleanedText: action.cleanedText,
        cleanupFailed: action.cleanupFailed,
      };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return initialDictationState;
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

// ---- Async runner (pure, injectable) --------------------------------------

export interface DictationDeps {
  transcribe: typeof sharedTranscribe;
  cleanTranscript: typeof sharedCleanTranscript;
  getSettings: () => Settings;
  resolveSecret: (ref: string) => Promise<string>;
  saveHistory: (record: AppHistoryRecord) => Promise<void>;
  now?: () => number;
  makeId?: () => string;
}

export interface ProcessResult {
  status: 'ready' | 'error';
  rawText?: string;
  cleanedText?: string;
  error?: string;
  cleanupFailed: boolean;
  record?: AppHistoryRecord;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Shared tail of every dictation path: given a raw transcript, optionally clean
 * it, write the (privacy-redacted) history row, and emit the terminal state.
 *
 * - Cleanup failure (when enabled) → falls back to raw text, writes a raw-only
 *   history row flagged `cleanupFailed`, and still resolves `ready`.
 *
 * `sttProvider` is recorded on the history row: the configured provider for the
 * remote/self-hosted path, or {@link ON_DEVICE_PROVIDER} for local dictation.
 */
export async function finishDictation(
  rawText: string,
  durationMs: number,
  sttProvider: string,
  deps: DictationDeps,
  dispatch: (action: DictationAction) => void,
  opts: { appContext?: string } = {},
): Promise<ProcessResult> {
  const settings = deps.getSettings();
  const now = deps.now ?? Date.now;
  const makeId =
    deps.makeId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  // --- Cleanup (optional; unchanged in local mode — user's choice) ---
  let cleanedText = rawText;
  let cleanupFailed = false;
  let cleanupProvider: string | undefined;
  if (settings.cleanup.enabled) {
    dispatch({ type: 'CLEANING' });
    try {
      const cleanupKey = await deps.resolveSecret(settings.cleanup.apiKeyRef);
      const result = await deps.cleanTranscript({
        settings: settings.cleanup,
        transcript: rawText,
        apiKey: cleanupKey,
        prompts: settings.prompts,
      });
      cleanedText = result.text;
      cleanupProvider = settings.cleanup.provider;
    } catch {
      // Non-fatal: keep the raw transcript, flag the row.
      cleanupFailed = true;
      cleanedText = rawText;
    }
  }

  // --- History row (redacted per privacy mode) ---
  const bestText = cleanupFailed || !settings.cleanup.enabled ? rawText : cleanedText;
  const fullRecord: HistoryRecord = {
    id: makeId(),
    ts: now(),
    appContext: opts.appContext,
    rawText,
    cleanedText: settings.cleanup.enabled && !cleanupFailed ? cleanedText : undefined,
    wordCount: countWords(bestText),
    durationMs,
    sttProvider,
    cleanupProvider,
    privacyMode: settings.privacyMode,
  };
  const record: AppHistoryRecord = {
    ...applyPrivacy(fullRecord, settings.privacyMode),
    cleanupFailed: cleanupFailed || undefined,
  };
  await deps.saveHistory(record);

  dispatch({ type: 'READY', rawText, cleanedText, cleanupFailed });
  return { status: 'ready', rawText, cleanedText, cleanupFailed, record };
}

/**
 * Remote / self-hosted path: transcribe (+ optionally clean) a finished audio
 * clip, emitting the state transitions via `dispatch` and writing a history row.
 *
 * - STT failure → `error`, NO history row.
 */
export async function processClip(
  clip: RecordedClip,
  deps: DictationDeps,
  dispatch: (action: DictationAction) => void,
  opts: { appContext?: string } = {},
): Promise<ProcessResult> {
  const settings = deps.getSettings();

  // --- STT ---
  dispatch({ type: 'TRANSCRIBING' });
  let rawText: string;
  try {
    const sttKey = await deps.resolveSecret(settings.stt.apiKeyRef);
    const result = await deps.transcribe({
      settings: settings.stt,
      audio: { bytes: clip.bytes, mimeType: clip.mimeType, fileName: clip.fileName },
      apiKey: sttKey,
    });
    rawText = result.text;
  } catch (err) {
    const error = describeError(err);
    dispatch({ type: 'ERROR', error });
    return { status: 'error', error, cleanupFailed: false };
  }
  dispatch({ type: 'TRANSCRIBED', rawText });

  return finishDictation(rawText, clip.durationMs, settings.stt.provider, deps, dispatch, opts);
}

/**
 * Local (on-device) path: the platform recognizer has already produced
 * `transcript` (there is no audio clip to upload). We surface the finalize step
 * (`transcribing` → `transcribed`) then run the SAME cleanup + history tail as
 * the remote path, recording {@link ON_DEVICE_PROVIDER} as the STT provider.
 */
export async function processLocalTranscript(
  transcript: string,
  durationMs: number,
  deps: DictationDeps,
  dispatch: (action: DictationAction) => void,
  opts: { appContext?: string } = {},
): Promise<ProcessResult> {
  const rawText = transcript.trim();
  dispatch({ type: 'TRANSCRIBING' });
  dispatch({ type: 'TRANSCRIBED', rawText });
  return finishDictation(rawText, durationMs, ON_DEVICE_PROVIDER, deps, dispatch, opts);
}

/** Copy shown when the local recognizer / permission is unavailable. */
export const LOCAL_UNAVAILABLE_ERROR =
  'On-device speech recognition is unavailable on this device. Switch to a Remote provider in Settings, or install the required language pack.';
export const LOCAL_PERMISSION_ERROR = 'Speech-recognition permission denied.';

/**
 * Begin a local (on-device) live-recognition session. Strictly on-device — if
 * the recognizer is unavailable we emit `error` and DO NOT start (never a
 * silent cloud fallback). Interim transcripts stream in as `PARTIAL` actions.
 *
 * Returns whether recognition actually started.
 */
export async function startLocalSession(
  recognizer: LocalStt,
  dispatch: (action: DictationAction) => void,
  opts: { lang?: string; onError?: (error: string) => void } = {},
): Promise<boolean> {
  const fail = (error: string): boolean => {
    dispatch({ type: 'ERROR', error });
    opts.onError?.(error);
    return false;
  };

  const availability = await recognizer.isAvailable(opts.lang);
  if (!availability.available) {
    return fail(availability.reason ?? LOCAL_UNAVAILABLE_ERROR);
  }
  const granted = await recognizer.requestPermission();
  if (!granted) {
    return fail(LOCAL_PERMISSION_ERROR);
  }
  try {
    await recognizer.start({
      lang: opts.lang,
      onPartial: (text) => dispatch({ type: 'PARTIAL', text }),
    });
    dispatch({ type: 'RECORD_START' });
    return true;
  } catch (err) {
    return fail(describeError(err));
  }
}

// ---- React hook -----------------------------------------------------------

export interface UseDictationOptions {
  recorder: DictationRecorder;
  /** On-device recognizer — required when `settings.stt.mode === 'local'`. */
  localStt?: LocalStt;
  getSettings: () => Settings;
  resolveSecret: (ref: string) => Promise<string>;
  saveHistory: (record: AppHistoryRecord) => Promise<void>;
  /** App/context tag stored on the history row (bundle id, "keyboard", ...). */
  appContext?: string;
  /** Fired after a session resolves (ready or error) — used by the iOS hop. */
  onResult?: (result: ProcessResult) => void;
  /** Fired when the machine enters a new status — used to stream hop status. */
  onStatus?: (status: DictationStatus) => void;
}

export interface UseDictationApi {
  state: DictationState;
  /** Request permission and begin recording. */
  start: () => Promise<void>;
  /** Stop recording and run STT (+cleanup). */
  stop: () => Promise<void>;
  reset: () => void;
}

const PERMISSION_ERROR = 'Microphone permission denied.';

export function useDictation(options: UseDictationOptions): UseDictationApi {
  const {
    recorder,
    localStt,
    getSettings,
    resolveSecret,
    saveHistory,
    appContext,
    onResult,
    onStatus,
  } = options;
  const [state, dispatch] = useReducer(dictationReducer, initialDictationState);
  /** Wall-clock start of a local session (no audio clip to measure duration). */
  const localStartedAtRef = useRef(0);

  const wrappedDispatch = useCallback(
    (action: DictationAction) => {
      dispatch(action);
      if (onStatus) {
        if (action.type === 'RECORD_START') onStatus('recording');
        else if (action.type === 'TRANSCRIBING') onStatus('transcribing');
        else if (action.type === 'CLEANING') onStatus('cleaning');
        else if (action.type === 'READY') onStatus('ready');
        else if (action.type === 'ERROR') onStatus('error');
      }
    },
    [onStatus],
  );

  const start = useCallback(async () => {
    // --- Local (on-device) path: no record-file+upload; live recognition. ---
    if (getSettings().stt.mode === 'local') {
      if (!localStt) {
        wrappedDispatch({ type: 'ERROR', error: LOCAL_UNAVAILABLE_ERROR });
        onResult?.({ status: 'error', error: LOCAL_UNAVAILABLE_ERROR, cleanupFailed: false });
        return;
      }
      localStartedAtRef.current = Date.now();
      await startLocalSession(localStt, wrappedDispatch, {
        onError: (error) => onResult?.({ status: 'error', error, cleanupFailed: false }),
      });
      return;
    }

    // --- Remote / self-hosted path: record an audio clip to upload. ---
    try {
      const granted = await recorder.requestPermission();
      if (!granted) {
        wrappedDispatch({ type: 'ERROR', error: PERMISSION_ERROR });
        onResult?.({ status: 'error', error: PERMISSION_ERROR, cleanupFailed: false });
        return;
      }
      await recorder.start();
      wrappedDispatch({ type: 'RECORD_START' });
    } catch (err) {
      const error = describeError(err);
      wrappedDispatch({ type: 'ERROR', error });
      onResult?.({ status: 'error', error, cleanupFailed: false });
    }
  }, [recorder, localStt, getSettings, wrappedDispatch, onResult]);

  const buildDeps = useCallback(
    (): DictationDeps => ({
      transcribe: sharedTranscribe,
      cleanTranscript: sharedCleanTranscript,
      getSettings,
      resolveSecret,
      saveHistory,
    }),
    [getSettings, resolveSecret, saveHistory],
  );

  const stop = useCallback(async () => {
    // --- Local (on-device) path: finalize live recognition, skip upload. ---
    if (getSettings().stt.mode === 'local') {
      if (!localStt) {
        wrappedDispatch({ type: 'ERROR', error: LOCAL_UNAVAILABLE_ERROR });
        onResult?.({ status: 'error', error: LOCAL_UNAVAILABLE_ERROR, cleanupFailed: false });
        return;
      }
      let transcript: string;
      try {
        ({ transcript } = await localStt.stop());
      } catch (err) {
        const error = describeError(err);
        wrappedDispatch({ type: 'ERROR', error });
        onResult?.({ status: 'error', error, cleanupFailed: false });
        return;
      }
      const durationMs = Math.max(0, Date.now() - localStartedAtRef.current);
      const result = await processLocalTranscript(
        transcript,
        durationMs,
        buildDeps(),
        wrappedDispatch,
        { appContext },
      );
      onResult?.(result);
      return;
    }

    // --- Remote / self-hosted path. ---
    let clip: RecordedClip;
    try {
      clip = await recorder.stop();
    } catch (err) {
      const error = describeError(err);
      wrappedDispatch({ type: 'ERROR', error });
      onResult?.({ status: 'error', error, cleanupFailed: false });
      return;
    }
    const result = await processClip(clip, buildDeps(), wrappedDispatch, { appContext });
    onResult?.(result);
  }, [recorder, localStt, getSettings, buildDeps, appContext, wrappedDispatch, onResult]);

  const reset = useCallback(() => {
    // Cancel an in-flight local session so the recognizer stops listening.
    if (localStt && getSettings().stt.mode === 'local' && state.status === 'recording') {
      void localStt.cancel();
    }
    dispatch({ type: 'RESET' });
  }, [localStt, getSettings, state.status]);

  return { state, start, stop, reset };
}
