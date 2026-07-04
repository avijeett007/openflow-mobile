import {
  type DownloadPackOptions,
  type PairStatus,
  type TranslateResult,
  type TranslationAvailability,
  type TranslatorModuleApi,
} from '@openflow/shared';

/**
 * translator — thin, defensive wrapper around the `modules/translator` native
 * module (T2: Swift Apple Translation / Kotlin ML Kit).
 *
 * The native module is loaded via `requireOptionalNativeModule('Translator')`
 * (the same pattern as `loadSpeechModule` / `settingsBridge`) so this file — and
 * the whole app — keeps running under Jest / Expo Go / web where the native
 * module is absent. When it's missing every method degrades cleanly:
 *   - `isTranslationAvailable()` → `{ available: false, reason }`
 *   - `translate()` / `downloadPack()` reject with a clear error
 *   - list methods resolve empty / null, `getPairStatus()` → `'unsupported'`
 *
 * The JS surface ({@link TranslatorModuleApi}) is FROZEN in `@openflow/shared`
 * (T1) — this wrapper implements exactly that shape, adding nothing.
 */

/**
 * The registered native module name. T2's `modules/translator` MUST export a
 * module named exactly this (Swift `Name("Translator")`, Kotlin
 * `Name("Translator")`). If T2 chose a different name, change this constant.
 */
export const TRANSLATOR_NATIVE_MODULE_NAME = 'Translator';

const MODULE_UNAVAILABLE =
  'On-device translation is not available in this build (the Translator native module is missing). ' +
  'It requires a development or production build — Expo Go and the iOS Simulator cannot translate.';

/** Dynamically load the native Translator module; `null` when it does not exist. */
export function loadTranslatorModule(): TranslatorModuleApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core');
    const native = requireOptionalNativeModule(TRANSLATOR_NATIVE_MODULE_NAME);
    if (!native) return null;
    return native as TranslatorModuleApi;
  } catch {
    return null;
  }
}

/**
 * Build a {@link TranslatorModuleApi} backed by the given loader (defaults to
 * the real native module). Every method guards a missing module so callers
 * never crash in Jest / Expo Go. Injectable for tests.
 */
export function createTranslator(
  getModule: () => TranslatorModuleApi | null = loadTranslatorModule,
): TranslatorModuleApi {
  return {
    translate(text: string, from: string, to: string): Promise<TranslateResult> {
      const mod = getModule();
      if (!mod) return Promise.reject(new Error(MODULE_UNAVAILABLE));
      return mod.translate(text, from, to);
    },

    getPairStatus(from: string, to: string): Promise<PairStatus> {
      const mod = getModule();
      if (!mod) return Promise.resolve('unsupported');
      return mod.getPairStatus(from, to);
    },

    downloadPack(from: string, to: string, opts?: DownloadPackOptions): Promise<void> {
      const mod = getModule();
      if (!mod) return Promise.reject(new Error(MODULE_UNAVAILABLE));
      return mod.downloadPack(from, to, opts);
    },

    listSupportedLanguages(): Promise<string[]> {
      const mod = getModule();
      if (!mod) return Promise.resolve([]);
      return mod.listSupportedLanguages().catch(() => []);
    },

    listDownloadedLanguages(): Promise<string[]> {
      const mod = getModule();
      if (!mod) return Promise.resolve([]);
      return mod.listDownloadedLanguages().catch(() => []);
    },

    deletePack(lang: string): Promise<boolean> {
      const mod = getModule();
      if (!mod) return Promise.resolve(false);
      return mod.deletePack(lang);
    },

    identifyLanguage(text: string): Promise<string | null> {
      const mod = getModule();
      if (!mod) return Promise.resolve(null);
      return mod.identifyLanguage(text).catch(() => null);
    },

    sttOnDeviceLocales(): Promise<string[] | null> {
      const mod = getModule();
      if (!mod) return Promise.resolve(null);
      return mod.sttOnDeviceLocales().catch(() => null);
    },

    isTranslationAvailable(): Promise<TranslationAvailability> {
      const mod = getModule();
      if (!mod) return Promise.resolve({ available: false, reason: MODULE_UNAVAILABLE });
      return mod
        .isTranslationAvailable()
        .catch((err: unknown) => ({
          available: false,
          reason: err instanceof Error ? err.message : String(err),
        }));
    },
  };
}

/** App-wide singleton translator. */
export const translator: TranslatorModuleApi = createTranslator();
