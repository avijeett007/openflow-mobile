import { Platform } from 'react-native';
import { toTranslationLang } from '@openflow/shared';

/**
 * localStt — thin wrapper around the PLATFORM on-device speech recognizers via
 * `expo-speech-recognition` (jamsch): iOS `SFSpeechRecognizer` with on-device
 * recognition, Android's built-in `SpeechRecognizer`.
 *
 * STRICTLY ON-DEVICE. We pass `requiresOnDeviceRecognition: true` (iOS) and
 * `EXTRA_PREFER_OFFLINE: true` (Android). If the device cannot recognize
 * on-device (missing language pack, unsupported OS/hardware) we surface a clear
 * error rather than SILENTLY falling back to cloud recognition — a cloud
 * fallback would betray the "Local (on-device)" promise (audio would leave the
 * device without consent). No API key, no network, no model download.
 *
 * The underlying native module is loaded DEFENSIVELY (dynamic require) so this
 * file and the whole app keep running under Jest / Expo Go / web, where the
 * native module is absent — `isAvailable()` then reports `available: false`.
 *
 * Package choice + evidence: docs/NOTES-LOCAL-STT.md.
 */

// ---- Public interface -----------------------------------------------------

export interface LocalSttAvailability {
  available: boolean;
  /** Machine-ish reason when unavailable (also used for UI copy). */
  reason?: string;
}

export interface LocalSttStartOptions {
  /** BCP-47 language tag. Default 'en-US'. */
  lang?: string;
  /** Interim (partial) transcript, streamed while listening. */
  onPartial?: (text: string) => void;
  /** A finalized segment was recognized. */
  onFinal?: (text: string) => void;
  /** Recognizer errored mid-session (not from an explicit cancel). */
  onError?: (error: string) => void;
}

/**
 * Live on-device recognizer. `stop()` resolves with the accumulated transcript
 * (mirroring the file recorder's `stop(): RecordedClip` shape) so `useDictation`
 * can treat local and remote uniformly.
 */
export interface LocalStt {
  /** Can on-device recognition run right now? (and why not, if not) */
  isAvailable(lang?: string): Promise<LocalSttAvailability>;
  /** Request mic + speech-recognition permission; returns whether granted. */
  requestPermission(): Promise<boolean>;
  /** Begin strictly on-device live recognition. */
  start(opts?: LocalSttStartOptions): Promise<void>;
  /** Stop capture and resolve the final transcript. */
  stop(): Promise<{ transcript: string }>;
  /** Abort without producing a transcript. */
  cancel(): Promise<void>;
}

// ---- Minimal typing of the parts of the module we use ---------------------

interface SpeechResultEvent {
  isFinal: boolean;
  results: { transcript: string }[];
}
interface SpeechErrorEvent {
  error: string;
  message?: string;
}
interface Subscription {
  remove(): void;
}

/** Android `getSupportedLocales()` result (jamsch expo-speech-recognition). */
export interface SupportedLocales {
  /** All languages the recognizer knows (installed + downloadable). */
  locales: string[];
  /** Languages whose offline model is installed on the device right now. */
  installedLocales: string[];
}

export interface SpeechModule {
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  start(options: Record<string, unknown>): void;
  stop(): void;
  abort(): void;
  addSpeechRecognitionListener(
    event: 'result' | 'error' | 'end',
    listener: (ev: SpeechResultEvent | SpeechErrorEvent | undefined) => void,
  ): Subscription;
  /** [Android 13+] Enumerate on-device locales. Empty/absent below API 33. */
  getSupportedLocales?(options: { androidRecognitionServicePackage?: string }): Promise<SupportedLocales>;
  /** [Android 13+] Trigger download of an offline recognition model. */
  androidTriggerOfflineModelDownload?(options: { locale: string }): Promise<{
    status: string;
    message: string;
  }>;
}

/** Default Android recognition-service package that owns the offline models. */
const ANDROID_ON_DEVICE_SERVICE = 'com.google.android.as';

/** Dynamically load the native module; `null` where it does not exist. */
export function loadSpeechModule(): SpeechModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition');
    const m = mod?.ExpoSpeechRecognitionModule;
    if (!m) return null;
    // `addSpeechRecognitionListener` is exported at top-level, not on the module.
    const addListener = mod.addSpeechRecognitionListener;
    return {
      isRecognitionAvailable: () => m.isRecognitionAvailable(),
      supportsOnDeviceRecognition: () => m.supportsOnDeviceRecognition(),
      requestPermissionsAsync: () => m.requestPermissionsAsync(),
      getPermissionsAsync: () => m.getPermissionsAsync(),
      start: (options) => m.start(options),
      stop: () => m.stop(),
      abort: () => m.abort(),
      addSpeechRecognitionListener: (event, listener) => addListener(event, listener),
      // T4: optional Android locale enumeration / model download (API 33+).
      getSupportedLocales:
        typeof m.getSupportedLocales === 'function'
          ? (options) => m.getSupportedLocales(options)
          : undefined,
      androidTriggerOfflineModelDownload:
        typeof m.androidTriggerOfflineModelDownload === 'function'
          ? (options) => m.androidTriggerOfflineModelDownload(options)
          : undefined,
    };
  } catch {
    return null;
  }
}

const MODULE_UNAVAILABLE =
  'On-device speech recognition is not available in this build (native module missing).';

/** Best transcript string out of a result event. */
function pickTranscript(ev: SpeechResultEvent | undefined): string {
  return ev?.results?.[0]?.transcript ?? '';
}

/**
 * Build a {@link LocalStt} backed by the given module (defaults to the real
 * native module). Injectable for tests.
 */
export function createLocalStt(getModule: () => SpeechModule | null = loadSpeechModule): LocalStt {
  let subs: Subscription[] = [];
  let finalText = '';
  let interimText = '';
  let sessionError: string | undefined;
  let ended = false;
  let pending: { resolve: (v: { transcript: string }) => void; reject: (e: Error) => void } | null =
    null;

  function cleanup(): void {
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        // ignore
      }
    }
    subs = [];
  }

  function combined(): string {
    const t = `${finalText} ${interimText}`.trim();
    return t;
  }

  function settle(): void {
    if (!pending) return;
    const p = pending;
    pending = null;
    cleanup();
    if (sessionError) {
      p.reject(new Error(sessionError));
    } else {
      p.resolve({ transcript: combined() });
    }
  }

  return {
    async isAvailable(lang?: string): Promise<LocalSttAvailability> {
      const mod = getModule();
      if (!mod) return { available: false, reason: MODULE_UNAVAILABLE };
      try {
        if (!mod.isRecognitionAvailable()) {
          return {
            available: false,
            reason: 'Speech recognition is unavailable on this device.',
          };
        }
        if (!mod.supportsOnDeviceRecognition()) {
          return {
            available: false,
            reason:
              Platform.OS === 'ios'
                ? 'On-device dictation is not supported on this device / iOS version. Enable Siri & Dictation, or use a Remote provider.'
                : 'On-device speech recognition is not installed. Install offline speech (Settings → speech services / language packs), or use a Remote provider.',
          };
        }
        // T4: when a specific language is requested, verify the device actually
        // has an on-device recognizer for it — but ONLY where the platform lets
        // us enumerate locales (Android API 33+). iOS per-locale support is
        // reported by the translator module's `sttOnDeviceLocales()`, and an
        // empty/failed enumeration must NOT block (fail open, not closed).
        if (lang && Platform.OS === 'android' && mod.getSupportedLocales) {
          try {
            const { locales, installedLocales } = await mod.getSupportedLocales({
              androidRecognitionServicePackage: ANDROID_ON_DEVICE_SERVICE,
            });
            const installed = installedLocales ?? [];
            const all = locales ?? [];
            // Prefer the installed (offline-ready) list; fall back to the full
            // supported list when the service doesn't report installed models.
            const known = installed.length > 0 ? installed : all;
            if (known.length > 0 && toTranslationLang(lang, known) === null) {
              return {
                available: false,
                reason: `On-device speech recognition for "${lang}" is not installed. Download the offline language, or pick another language.`,
              };
            }
          } catch {
            // Enumeration unavailable (API < 33, missing service) — don't block.
          }
        }
        return { available: true };
      } catch (err) {
        return { available: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },

    async requestPermission(): Promise<boolean> {
      const mod = getModule();
      if (!mod) return false;
      try {
        const existing = await mod.getPermissionsAsync();
        if (existing.granted) return true;
        const res = await mod.requestPermissionsAsync();
        return res.granted;
      } catch {
        return false;
      }
    },

    async start(opts: LocalSttStartOptions = {}): Promise<void> {
      const mod = getModule();
      if (!mod) throw new Error(MODULE_UNAVAILABLE);

      // Reset session state.
      finalText = '';
      interimText = '';
      sessionError = undefined;
      ended = false;
      pending = null;
      cleanup();

      subs.push(
        mod.addSpeechRecognitionListener('result', (ev) => {
          const res = ev as SpeechResultEvent;
          const text = pickTranscript(res);
          if (res?.isFinal) {
            finalText = `${finalText} ${text}`.trim();
            interimText = '';
            opts.onFinal?.(finalText);
          } else {
            interimText = text;
            opts.onPartial?.(combined());
          }
        }),
      );
      subs.push(
        mod.addSpeechRecognitionListener('error', (ev) => {
          const e = ev as SpeechErrorEvent;
          // An explicit cancel() surfaces as `aborted` — not a real failure.
          if (e?.error === 'aborted') return;
          sessionError = e?.message || e?.error || 'Speech recognition failed.';
          opts.onError?.(sessionError);
        }),
      );
      subs.push(
        mod.addSpeechRecognitionListener('end', () => {
          ended = true;
          settle();
        }),
      );

      mod.start({
        lang: opts.lang ?? 'en-US',
        interimResults: true,
        continuous: true,
        // STRICTLY on-device — never send audio to the cloud.
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        androidIntentOptions: {
          EXTRA_PREFER_OFFLINE: true,
        },
        iosTaskHint: 'dictation',
      });
    },

    stop(): Promise<{ transcript: string }> {
      const mod = getModule();
      if (!mod) return Promise.reject(new Error(MODULE_UNAVAILABLE));
      // If the recognizer already ended (e.g. silence timeout), resolve now.
      if (ended) {
        cleanup();
        return sessionError
          ? Promise.reject(new Error(sessionError))
          : Promise.resolve({ transcript: combined() });
      }
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        try {
          mod.stop(); // emits a final `result` then `end` → settle()
        } catch (err) {
          pending = null;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },

    async cancel(): Promise<void> {
      const mod = getModule();
      pending = null;
      cleanup();
      if (!mod) return;
      try {
        mod.abort();
      } catch {
        // ignore
      }
    },
  };
}

/** App-wide singleton recognizer. */
export const localStt: LocalStt = createLocalStt();

// ---- T4: Android on-device locale enumeration / model download -------------

/**
 * Safely enumerate the device's on-device STT locales.
 *
 * - Android API 33+ → `{ locales, installedLocales }` from the on-device
 *   recognition service.
 * - Android < 33, non-Android, or any failure → `null` (enumeration
 *   unavailable). Callers treat `null` as "STT locales UNKNOWN" (see
 *   `computeUsable`'s `sttKnown: false`), NOT as "no locales".
 *
 * iOS callers should prefer the translator module's `sttOnDeviceLocales()`
 * (SFSpeechRecognizer × on-device support) — this wrapper only covers Android.
 */
export async function getSupportedLocalesSafe(
  getModule: () => SpeechModule | null = loadSpeechModule,
): Promise<SupportedLocales | null> {
  if (Platform.OS !== 'android') return null;
  const mod = getModule();
  if (!mod || !mod.getSupportedLocales) return null;
  try {
    const res = await mod.getSupportedLocales({
      androidRecognitionServicePackage: ANDROID_ON_DEVICE_SERVICE,
    });
    return { locales: res.locales ?? [], installedLocales: res.installedLocales ?? [] };
  } catch {
    return null;
  }
}

export interface OfflineModelDownloadResult {
  ok: boolean;
  /** e.g. 'download_success' | 'opened_dialog' | 'download_canceled', or an error. */
  status?: string;
  message?: string;
}

/**
 * Trigger download of an Android offline recognition model for `locale`.
 * Android 13+ only; on Android 12/non-Android/failure resolves `{ ok: false }`
 * with a reason. (Used by the Translator picker's "STT pack missing" rows.)
 */
export async function triggerAndroidOfflineModelDownload(
  locale: string,
  getModule: () => SpeechModule | null = loadSpeechModule,
): Promise<OfflineModelDownloadResult> {
  if (Platform.OS !== 'android') {
    return { ok: false, message: 'Offline model download is Android-only.' };
  }
  const mod = getModule();
  if (!mod || !mod.androidTriggerOfflineModelDownload) {
    return {
      ok: false,
      message: 'Offline speech model download requires Android 13 or newer.',
    };
  }
  try {
    const res = await mod.androidTriggerOfflineModelDownload({ locale });
    // 'download_canceled' is a user action, not success.
    const ok = res.status === 'download_success' || res.status === 'opened_dialog';
    return { ok, status: res.status, message: res.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ---- "Test" helper (Settings / onboarding) --------------------------------

export interface LocalSttTestResult {
  ok: boolean;
  detail?: string;
}

/**
 * A short live-listen used by the Settings "Test" button: verifies the
 * recognizer is available and actually starts, listens for `ms`, then reports
 * whether it produced anything. Availability errors surface as `ok: false`.
 */
export async function runLocalSttTest(
  recognizer: LocalStt = localStt,
  ms = 2000,
  waitFn: (ms: number) => Promise<void> = (t) => new Promise((r) => setTimeout(r, t)),
): Promise<LocalSttTestResult> {
  const availability = await recognizer.isAvailable();
  if (!availability.available) {
    return { ok: false, detail: availability.reason };
  }
  const granted = await recognizer.requestPermission();
  if (!granted) {
    return { ok: false, detail: 'Speech-recognition permission was not granted.' };
  }
  try {
    let heardPartial = false;
    await recognizer.start({ onPartial: () => (heardPartial = true) });
    await waitFn(ms);
    const { transcript } = await recognizer.stop();
    const heard = transcript.trim().length > 0 || heardPartial;
    return {
      ok: true,
      detail: heard
        ? `Heard: "${transcript.trim() || '…'}"`
        : 'Recognizer ran (no speech detected — try speaking during the test).',
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
