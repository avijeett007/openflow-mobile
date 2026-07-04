/**
 * Shared types for the `modules/translator` local expo module.
 *
 * These mirror the FROZEN JS surface from DESIGN-mobile-translator.md verbatim.
 * A later integration pass (T5) reconciles these against `@openflow/shared`'s
 * `TranslatorModuleApi`; until then this module owns its own copy so the two
 * agents (T1 shared, T2 native) do not collide. Keep in lock-step with the spec.
 */

/** Pack availability for a single (from → to) translation direction. */
export type PairStatus = 'installed' | 'downloadable' | 'unsupported';

/** Result of a single translation. */
export interface TranslateResult {
  text: string;
}

/** Options for {@link TranslatorApi.downloadPack}. */
export interface DownloadPackOptions {
  /**
   * Android: gate the ML Kit model download on an unmetered (Wi-Fi) connection.
   * Default `true`. iOS ignores this — downloads are driven by the system
   * consent sheet, which the user controls.
   */
  wifiOnly?: boolean;
}

/** Whether translation can run at all on this build/OS, and why not if not. */
export interface TranslationAvailability {
  available: boolean;
  /** Machine-ish reason when unavailable (also drives UI copy). */
  reason?: string;
}

/**
 * The frozen public surface. Both the native modules and the defensive JS
 * loader implement exactly this shape.
 */
export interface TranslatorApi {
  translate(text: string, from: string, to: string): Promise<TranslateResult>;
  getPairStatus(from: string, to: string): Promise<PairStatus>;
  downloadPack(from: string, to: string, opts?: DownloadPackOptions): Promise<void>;
  listSupportedLanguages(): Promise<string[]>;
  listDownloadedLanguages(): Promise<string[]>;
  /** iOS always resolves `false` (packs are system-managed via Settings ▸ Apps ▸ Translate). */
  deletePack(lang: string): Promise<boolean>;
  identifyLanguage(text: string): Promise<string | null>;
  /** Android resolves `null` (the app enumerates STT locales via expo-speech-recognition). */
  sttOnDeviceLocales(): Promise<string[] | null>;
  isTranslationAvailable(): Promise<TranslationAvailability>;
}

/**
 * The subset of the raw native module we call. It is identical to
 * {@link TranslatorApi} except `downloadPack` takes a resolved `wifiOnly`
 * boolean (the JS layer applies the default) — native functions take positional
 * args rather than an options object.
 */
export interface TranslatorNativeModule {
  translate(text: string, from: string, to: string): Promise<TranslateResult>;
  getPairStatus(from: string, to: string): Promise<PairStatus>;
  downloadPack(from: string, to: string, wifiOnly: boolean): Promise<void>;
  listSupportedLanguages(): Promise<string[]>;
  listDownloadedLanguages(): Promise<string[]>;
  deletePack(lang: string): Promise<boolean>;
  identifyLanguage(text: string): Promise<string | null>;
  sttOnDeviceLocales(): Promise<string[] | null>;
  isTranslationAvailable(): Promise<TranslationAvailability>;
}
