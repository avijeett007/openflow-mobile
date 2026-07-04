/**
 * modules/translator JS surface — FROZEN contract (types only).
 *
 * This is the single source of truth for the native module's JS API. Chunk T2
 * (modules/translator, Swift + Kotlin) implements {@link TranslatorModuleApi};
 * chunk T3 (Translator UI) consumes it. Pure types — nothing here imports
 * React Native or the module itself, so it runs under plain node/Jest.
 *
 * Language codes throughout are BCP-47 strings AS REPORTED BY THE PLATFORM
 * (ML Kit: `he`, `no`, `tl`, bare `zh`; Apple: `zh-Hans`, `zh-Hant`, `en-GB`,
 * `en-US`, `pt-BR`). Use `langs.ts` to map STT locales onto these.
 */

/**
 * Per-PAIR availability as the native layers report it:
 * - `installed`    both models on device — translate() works fully offline now.
 * - `downloadable` supported, but at least one model needs a download first.
 * - `unsupported`  the platform cannot translate this pair at all.
 *
 * (The pure-TS pack tracker adds a fourth, client-side `downloading` state —
 * see {@link PackState} in `packs.ts`.)
 */
export type PairStatus = 'installed' | 'downloadable' | 'unsupported';

/** Runtime list of {@link PairStatus} values (for zod enums / UI switches). */
export const PAIR_STATUSES = ['installed', 'downloadable', 'unsupported'] as const;

export interface TranslateResult {
  text: string;
}

export interface DownloadPackOptions {
  /**
   * Android only: restrict the ML Kit model download to Wi-Fi
   * (`DownloadConditions.requireWifi()`). Defaults to `true` (~30 MB packs).
   * iOS ignores this — downloads go through the system consent sheet.
   */
  wifiOnly?: boolean;
}

export interface TranslationAvailability {
  available: boolean;
  /** Human-readable reason when unavailable (iOS <18, de-Googled Android, ...). */
  reason?: string;
}

/**
 * The complete JS API of `modules/translator`. T2's defensive loader (like
 * `loadSpeechModule` / `settingsBridge`) returns this shape — or a stub whose
 * `isTranslationAvailable()` resolves `{ available: false }` under Jest /
 * Expo Go / web.
 */
export interface TranslatorModuleApi {
  /** Translate `text` from `from` to `to`. Fails fast if a pack is missing (never silently downloads). */
  translate(text: string, from: string, to: string): Promise<TranslateResult>;
  /** Availability of the (from → to) pair. */
  getPairStatus(from: string, to: string): Promise<PairStatus>;
  /**
   * Download the packs needed for (from → to). Android: ML Kit
   * `downloadModelIfNeeded` with `wifiOnly` defaulting to true. iOS: hosted
   * `prepareTranslation()` — presents the system consent sheet.
   */
  downloadPack(from: string, to: string, opts?: DownloadPackOptions): Promise<void>;
  /** Platform translation languages (ML Kit: 59 codes; Apple: ~21 codes incl. region/script variants). */
  listSupportedLanguages(): Promise<string[]>;
  /** Languages whose models are on-device right now. */
  listDownloadedLanguages(): Promise<string[]>;
  /**
   * Delete a downloaded language model. Android: RemoteModelManager delete,
   * resolves `true`. iOS: resolves `false` — packs are system-managed
   * (Settings ▸ Apps ▸ Translate).
   */
  deletePack(lang: string): Promise<boolean>;
  /**
   * Best-effort language identification of `text` (ML Kit language-id /
   * NLLanguageRecognizer). `null` when undetermined.
   */
  identifyLanguage(text: string): Promise<string | null>;
  /**
   * iOS: locales supporting on-device SFSpeechRecognizer recognition.
   * Android: resolves `null` — JS enumerates via expo-speech-recognition.
   */
  sttOnDeviceLocales(): Promise<string[] | null>;
  /** Whether translation works at all on this device (iOS ≥18, Google services present, ...). */
  isTranslationAvailable(): Promise<TranslationAvailability>;
}
