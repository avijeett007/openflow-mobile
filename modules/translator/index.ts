import TranslatorModule from './src/TranslatorModule';
import type {
  DownloadPackOptions,
  PairStatus,
  TranslateResult,
  TranslationAvailability,
  TranslatorApi,
  TranslatorNativeModule,
} from './src/Translator.types';

export type {
  DownloadPackOptions,
  PairStatus,
  TranslateResult,
  TranslationAvailability,
  TranslatorApi,
  TranslatorNativeModule,
};

/**
 * modules/translator — thin, typed, DEFENSIVE JS surface over the native
 * on-device translator (Apple Translation framework on iOS 18+, ML Kit on
 * Android). Mirrors the `loadSpeechModule` / settings-bridge pattern: the
 * native module is loaded via `requireOptionalNativeModule`, so under Jest,
 * Expo Go, web, or a not-yet-prebuilt build the module is absent and this layer
 * degrades gracefully instead of throwing at import time.
 *
 * The frozen contract (DESIGN-mobile-translator.md → "modules/translator JS
 * surface"): translate / getPairStatus / downloadPack / listSupportedLanguages /
 * listDownloadedLanguages / deletePack / identifyLanguage / sttOnDeviceLocales /
 * isTranslationAvailable. See docs/NOTES-T2.md for platform behaviours.
 */

/** Reason surfaced when the native module is not linked into the build. */
export const MODULE_UNAVAILABLE =
  'On-device translation is not available in this build (native module missing).';

/**
 * Normalize any thrown value into a real `Error`. Native (expo-modules) errors
 * arrive as `CodedError`-ish objects with `code`/`message`; JS callers just want
 * a plain `Error` with a useful message. Keeps a `code` property when present so
 * the UI can special-case (e.g. iOS `ERR_TRANSLATE_OFFLINE`).
 */
export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object') {
    const anyErr = err as { message?: unknown; code?: unknown };
    const message =
      typeof anyErr.message === 'string' && anyErr.message.length > 0
        ? anyErr.message
        : 'Translation failed.';
    const e = new Error(message);
    if (typeof anyErr.code === 'string') {
      (e as Error & { code?: string }).code = anyErr.code;
    }
    return e;
  }
  return new Error(typeof err === 'string' && err ? err : 'Translation failed.');
}

const pairKey = (from: string, to: string) => `${from}|${to}`;

/**
 * Build a {@link TranslatorApi} backed by the given native module (defaults to
 * the real one). `getModule` is injectable so unit tests can drive the JS-layer
 * logic — the `wifiOnly` default, error normalization, unavailable fallbacks and
 * the pair-status cache — with a fake module and no native dependency.
 */
export function createTranslator(
  getModule: () => TranslatorNativeModule | null = () => TranslatorModule,
): TranslatorApi {
  // Small in-memory cache of getPairStatus() results. Pair status only changes
  // when a pack is downloaded or deleted, so we memoize reads (the picker calls
  // getPairStatus for many pairs) and invalidate on any mutation. Cache is
  // per-instance so tests start clean.
  const statusCache = new Map<string, PairStatus>();

  function clearStatusCache(): void {
    statusCache.clear();
  }

  return {
    async translate(text: string, from: string, to: string): Promise<TranslateResult> {
      const mod = getModule();
      if (!mod) throw new Error(MODULE_UNAVAILABLE);
      try {
        return await mod.translate(text, from, to);
      } catch (err) {
        throw normalizeError(err);
      }
    },

    async getPairStatus(from: string, to: string): Promise<PairStatus> {
      const mod = getModule();
      if (!mod) return 'unsupported';
      const key = pairKey(from, to);
      const cached = statusCache.get(key);
      if (cached) return cached;
      try {
        const status = await mod.getPairStatus(from, to);
        statusCache.set(key, status);
        return status;
      } catch (err) {
        throw normalizeError(err);
      }
    },

    async downloadPack(from: string, to: string, opts?: DownloadPackOptions): Promise<void> {
      const mod = getModule();
      if (!mod) throw new Error(MODULE_UNAVAILABLE);
      // Default Wi-Fi-only ON (spec): downloads are ~30MB, never silently on cellular.
      const wifiOnly = opts?.wifiOnly ?? true;
      try {
        await mod.downloadPack(from, to, wifiOnly);
      } catch (err) {
        throw normalizeError(err);
      } finally {
        // Availability just changed (or may have) — drop cached statuses.
        clearStatusCache();
      }
    },

    async listSupportedLanguages(): Promise<string[]> {
      const mod = getModule();
      if (!mod) return [];
      try {
        return await mod.listSupportedLanguages();
      } catch (err) {
        throw normalizeError(err);
      }
    },

    async listDownloadedLanguages(): Promise<string[]> {
      const mod = getModule();
      if (!mod) return [];
      try {
        return await mod.listDownloadedLanguages();
      } catch (err) {
        throw normalizeError(err);
      }
    },

    async deletePack(lang: string): Promise<boolean> {
      const mod = getModule();
      if (!mod) return false;
      try {
        return await mod.deletePack(lang);
      } catch (err) {
        throw normalizeError(err);
      } finally {
        clearStatusCache();
      }
    },

    async identifyLanguage(text: string): Promise<string | null> {
      const mod = getModule();
      if (!mod) return null;
      try {
        return await mod.identifyLanguage(text);
      } catch (err) {
        throw normalizeError(err);
      }
    },

    async sttOnDeviceLocales(): Promise<string[] | null> {
      const mod = getModule();
      if (!mod) return null;
      try {
        return await mod.sttOnDeviceLocales();
      } catch (err) {
        throw normalizeError(err);
      }
    },

    async isTranslationAvailable(): Promise<TranslationAvailability> {
      const mod = getModule();
      if (!mod) return { available: false, reason: MODULE_UNAVAILABLE };
      try {
        return await mod.isTranslationAvailable();
      } catch (err) {
        // A thrown availability check is itself an "unavailable" signal.
        return { available: false, reason: normalizeError(err).message };
      }
    },
  };
}

/** App-wide singleton translator over the real native module. */
export const translator: TranslatorApi = createTranslator();

export default translator;
