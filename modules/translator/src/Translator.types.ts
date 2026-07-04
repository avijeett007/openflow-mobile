/**
 * Types for the `modules/translator` local expo module.
 *
 * The FROZEN JS surface (DESIGN-mobile-translator.md → `TranslatorModuleApi`)
 * lives in `@openflow/shared` (T1) — the SINGLE SOURCE OF TRUTH. This module
 * re-exports those types (aliasing `TranslatorModuleApi` → `TranslatorApi` for
 * the local naming) and adds only `TranslatorNativeModule`, the raw native
 * surface (positional `wifiOnly`), which is internal to this module and not part
 * of the shared contract.
 *
 * (T5 integration: this file previously carried its own copy of the frozen
 * types so T1/T2 could land in parallel; those are now reconciled onto shared.)
 */
import type {
  DownloadPackOptions,
  PairStatus,
  TranslateResult,
  TranslationAvailability,
  TranslatorModuleApi,
} from '@openflow/shared';

export type {
  DownloadPackOptions,
  PairStatus,
  TranslateResult,
  TranslationAvailability,
};

/** The frozen public surface (single-sourced from `@openflow/shared`). */
export type TranslatorApi = TranslatorModuleApi;

/**
 * The subset of the raw native module we call. Identical to {@link TranslatorApi}
 * except `downloadPack` takes a resolved positional `wifiOnly` boolean — native
 * functions take positional args rather than an options object, and the JS layer
 * applies the `wifiOnly` default. Module-internal; not part of the shared contract.
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
