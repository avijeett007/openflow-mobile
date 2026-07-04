import { useMemo, useRef } from 'react';
import {
  useAudioRecorder,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { base64ToBytes } from './base64';

/**
 * Recording lives in the CONTAINER APP (iOS keyboards can't touch the mic; the
 * Android IME records itself in C4 — this recorder is for the app's own Dictate
 * surface and the iOS keyboard "hop").
 *
 * We use **expo-audio** (Expo SDK 53's current audio library). expo-av is
 * deprecated in 53 and slated for removal; expo-audio's recorder is stable
 * enough for whole-clip capture, which is all v1 needs. Choice documented in
 * docs/NOTES-C2.md.
 *
 * Everything the state machine touches is behind this thin `DictationRecorder`
 * interface so `useDictation` can be tested with a fake recorder.
 */

/** A finished recording, ready to hand to the shared STT client. */
export interface RecordedClip {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  durationMs: number;
}

export interface DictationRecorder {
  /** Ensure mic permission; returns whether recording may proceed. */
  requestPermission(): Promise<boolean>;
  /** Begin capturing. */
  start(): Promise<void>;
  /** Stop capturing and return the encoded clip bytes. */
  stop(): Promise<RecordedClip>;
}

/** 16 kHz mono AAC/m4a — small clips, plenty for speech, matches the desktop app. */
export const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
};

/**
 * React hook producing a stable `DictationRecorder` backed by expo-audio.
 * Must be called from a component/hook (expo-audio's recorder is a hook).
 */
export function useAppRecorder(): DictationRecorder {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const startedAtRef = useRef<number>(0);

  return useMemo<DictationRecorder>(
    () => ({
      async requestPermission() {
        const existing = await getRecordingPermissionsAsync();
        if (existing.granted) return true;
        const res = await requestRecordingPermissionsAsync();
        return res.granted;
      },

      async start() {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        startedAtRef.current = Date.now();
        recorder.record();
      },

      async stop() {
        await recorder.stop();
        const durationMs = Math.max(0, Date.now() - startedAtRef.current);
        const uri = recorder.uri;
        if (!uri) {
          throw new Error('Recording produced no file.');
        }
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return {
          bytes: base64ToBytes(base64),
          mimeType: 'audio/m4a',
          fileName: 'dictation.m4a',
          durationMs,
        };
      },
    }),
    [recorder],
  );
}
