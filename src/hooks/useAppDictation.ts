import { useAppRecorder } from '../lib/recorder';
import { localStt } from '../lib/localStt';
import { resolveSecret } from '../lib/secrets';
import { useAppState } from '../context/AppState';
import {
  type ProcessResult,
  type DictationStatus,
  type UseDictationApi,
  useDictation,
} from './useDictation';

/**
 * Wires `useDictation` to the app's real dependencies: the expo-audio recorder,
 * live settings from context, secure-store secret resolution, and history
 * persistence. Screens use this rather than plumbing deps by hand.
 */
export function useAppDictation(opts?: {
  appContext?: string;
  onResult?: (result: ProcessResult) => void;
  onStatus?: (status: DictationStatus) => void;
}): UseDictationApi {
  const recorder = useAppRecorder();
  const { getSettings, addRecord } = useAppState();

  return useDictation({
    recorder,
    localStt,
    getSettings,
    resolveSecret,
    saveHistory: addRecord,
    appContext: opts?.appContext,
    onResult: opts?.onResult,
    onStatus: opts?.onStatus,
  });
}
