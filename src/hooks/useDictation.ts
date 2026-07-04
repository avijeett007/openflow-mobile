import { useCallback, useReducer } from 'react';
import {
  type HistoryRecord,
  type Settings,
  applyPrivacy,
  cleanTranscript as sharedCleanTranscript,
  countWords,
  transcribe as sharedTranscribe,
} from '@openflow/shared';
import type { DictationRecorder, RecordedClip } from '../lib/recorder';
import type { AppHistoryRecord } from '../lib/historyStore';

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
    case 'TRANSCRIBING':
      return { ...state, status: 'transcribing', error: undefined };
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
 * Transcribe (+ optionally clean) a finished clip, emitting the state
 * transitions via `dispatch` and writing a history row.
 *
 * - STT failure  → `error`, NO history row.
 * - Cleanup failure (when enabled) → falls back to raw text, writes a raw-only
 *   history row flagged `cleanupFailed`, and still resolves `ready`.
 */
export async function processClip(
  clip: RecordedClip,
  deps: DictationDeps,
  dispatch: (action: DictationAction) => void,
  opts: { appContext?: string } = {},
): Promise<ProcessResult> {
  const settings = deps.getSettings();
  const now = deps.now ?? Date.now;
  const makeId =
    deps.makeId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

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

  // --- Cleanup (optional) ---
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
    durationMs: clip.durationMs,
    sttProvider: settings.stt.provider,
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

// ---- React hook -----------------------------------------------------------

export interface UseDictationOptions {
  recorder: DictationRecorder;
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
  const { recorder, getSettings, resolveSecret, saveHistory, appContext, onResult, onStatus } =
    options;
  const [state, dispatch] = useReducer(dictationReducer, initialDictationState);

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
  }, [recorder, wrappedDispatch, onResult]);

  const stop = useCallback(async () => {
    let clip: RecordedClip;
    try {
      clip = await recorder.stop();
    } catch (err) {
      const error = describeError(err);
      wrappedDispatch({ type: 'ERROR', error });
      onResult?.({ status: 'error', error, cleanupFailed: false });
      return;
    }
    const result = await processClip(
      clip,
      {
        transcribe: sharedTranscribe,
        cleanTranscript: sharedCleanTranscript,
        getSettings,
        resolveSecret,
        saveHistory,
      },
      wrappedDispatch,
      { appContext },
    );
    onResult?.(result);
  }, [recorder, getSettings, resolveSecret, saveHistory, appContext, wrappedDispatch, onResult]);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return { state, start, stop, reset };
}
