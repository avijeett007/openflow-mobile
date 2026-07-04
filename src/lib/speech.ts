import { bcp47Primary, langKey } from '@openflow/shared';

/** Normalized full BCP-47 tag for region-exact comparison (`en_US` → `en-us`). */
function normalizeTag(tag: string): string {
  return tag.trim().replace(/_/g, '-').toLowerCase();
}

/**
 * speech — a thin wrapper around `expo-speech` for the Offline Translator's
 * optional "speak the translation aloud" feature.
 *
 * `expo-speech` ships no config plugin and no native module of our own — it uses
 * the platform TTS engines (AVSpeechSynthesizer on iOS, android.speech.tts on
 * Android), which are fully on-device. This wrapper:
 *
 *  - caches `getAvailableVoicesAsync()` (the list is stable per launch and the
 *    call is comparatively expensive),
 *  - resolves the best voice for a language by BCP-47 PRIMARY subtag, preferring
 *    a REGION-EXACT match when one exists (`es-MX` beats `es-ES` for `es-MX`),
 *  - exposes `canSpeak(lang)` so the UI can grey out the speak toggle when no
 *    voice is installed for the target language,
 *  - `speak(text, lang, { onDone })` resolves when the utterance finishes (or is
 *    stopped / errors), and `stop()` supports barge-in.
 *
 * The native module is loaded DEFENSIVELY (dynamic require) so the file and the
 * whole app keep running under Jest / Expo Go / web where TTS may be absent —
 * `canSpeak()` then reports `false` and `speak()` resolves immediately.
 */

// ---- Minimal typing of the parts of expo-speech we use --------------------

export interface TtsVoice {
  identifier: string;
  name: string;
  language: string;
}

export interface TtsSpeakOptions {
  language?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
}

export interface SpeechTtsModule {
  getAvailableVoicesAsync(): Promise<TtsVoice[]>;
  speak(text: string, options?: TtsSpeakOptions): void;
  stop(): Promise<void>;
  maxSpeechInputLength: number;
}

/** Dynamically load `expo-speech`; `null` where it does not exist. */
export function loadTtsModule(): SpeechTtsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech');
    if (!mod || typeof mod.speak !== 'function') return null;
    return {
      getAvailableVoicesAsync: () => mod.getAvailableVoicesAsync(),
      speak: (text, options) => mod.speak(text, options),
      stop: () => mod.stop(),
      maxSpeechInputLength: mod.maxSpeechInputLength ?? 4000,
    };
  } catch {
    return null;
  }
}

// ---- Voice matching --------------------------------------------------------

/**
 * Pick the best voice for `lang` out of `voices`, or `null` when none match.
 * Two tiers: a REGION-EXACT full-key match first (`en-US` voice for `en-US`),
 * then any voice sharing the PRIMARY subtag (`en` voice for `en-GB`). Chinese
 * script is respected via `fullLangKey` (`zh-Hans`/`zh-Hant` stay distinct).
 */
export function matchVoice(lang: string, voices: readonly TtsVoice[]): TtsVoice | null {
  if (!bcp47Primary(lang)) return null;
  const wantFull = normalizeTag(lang);
  const wantLangKey = langKey(lang);
  const wantPrimary = bcp47Primary(lang);
  let langMatch: TtsVoice | null = null;
  let primaryMatch: TtsVoice | null = null;
  for (const v of voices) {
    if (!v.language) continue;
    if (normalizeTag(v.language) === wantFull) return v; // region-exact wins
    // Middle tier: primary + Chinese script (keeps zh-Hans/zh-Hant distinct).
    if (!langMatch && langKey(v.language) === wantLangKey) langMatch = v;
    if (!primaryMatch && bcp47Primary(v.language) === wantPrimary) primaryMatch = v;
  }
  return langMatch ?? primaryMatch;
}

// ---- Engine ----------------------------------------------------------------

export interface SpeechEngine {
  /** Cached list of installed TTS voices (empty when TTS is unavailable). */
  getVoices(): Promise<TtsVoice[]>;
  /** Is there an installed voice for `lang`? Gates the speak toggle. */
  canSpeak(lang: string): Promise<boolean>;
  /** Speak `text` in `lang`; resolves when the utterance ends/stops/errors. */
  speak(text: string, lang: string, opts?: { rate?: number }): Promise<void>;
  /** Stop any in-flight utterance (barge-in). */
  stop(): Promise<void>;
  /** Drop the cached voice list (e.g. after the user installs a voice). */
  refreshVoices(): void;
}

/**
 * Build a {@link SpeechEngine} over the given module (defaults to the real
 * `expo-speech`). Injectable for tests.
 */
export function createSpeech(getModule: () => SpeechTtsModule | null = loadTtsModule): SpeechEngine {
  let voicesPromise: Promise<TtsVoice[]> | null = null;

  async function getVoices(): Promise<TtsVoice[]> {
    const mod = getModule();
    if (!mod) return [];
    if (!voicesPromise) {
      voicesPromise = mod
        .getAvailableVoicesAsync()
        .then((v) => v ?? [])
        .catch(() => []);
    }
    return voicesPromise;
  }

  return {
    getVoices,

    async canSpeak(lang: string): Promise<boolean> {
      if (!getModule()) return false;
      const voices = await getVoices();
      // Some engines report no voices at all yet still speak the primary
      // language; only treat an explicitly-populated list as authoritative.
      if (voices.length === 0) return false;
      return matchVoice(lang, voices) !== null;
    },

    speak(text: string, lang: string, opts: { rate?: number } = {}): Promise<void> {
      const mod = getModule();
      if (!mod || !text.trim()) return Promise.resolve();
      return getVoices().then(
        (voices) =>
          new Promise<void>((resolve) => {
            const voice = matchVoice(lang, voices);
            let settled = false;
            const done = (): void => {
              if (settled) return;
              settled = true;
              resolve();
            };
            const clipped =
              text.length > mod.maxSpeechInputLength ? text.slice(0, mod.maxSpeechInputLength) : text;
            try {
              mod.speak(clipped, {
                language: lang,
                voice: voice?.identifier,
                rate: opts.rate,
                onDone: done,
                onStopped: done,
                onError: done, // a failed utterance must not hang the turn
              });
            } catch {
              done();
            }
          }),
      );
    },

    async stop(): Promise<void> {
      const mod = getModule();
      if (!mod) return;
      try {
        await mod.stop();
      } catch {
        // ignore — stop is best-effort (barge-in)
      }
    },

    refreshVoices(): void {
      voicesPromise = null;
    },
  };
}

/** App-wide singleton TTS engine. */
export const speech: SpeechEngine = createSpeech();
