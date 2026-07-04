/**
 * Offline Translator core (chunk T1) — pure TS, zero React Native imports.
 * FROZEN contract for chunks T2 (modules/translator) and T3 (Translator UI).
 */

// Conversation state machine
export {
  DEFAULT_LANGS,
  HISTORY_CAP,
  conversationReducer,
  initialConversationState,
  otherSide,
} from './conversation';
export type {
  ConversationAction,
  ConversationState,
  Exchange,
  Side,
  TurnStatus,
} from './conversation';

// Pack tracking
export { PACK_STATES, getPackState, initialPackMap, packReducer } from './packs';
export type { PackAction, PackMap, PackState } from './packs';

// Language mapping
export {
  FALLBACK_DISPLAY_NAMES,
  PRIMARY_ALIASES,
  bcp47Primary,
  canonicalPrimary,
  computeUsable,
  displayLanguageName,
  langKey,
  pickSttLocale,
  toTranslationLang,
} from './langs';
export type { UsableLang } from './langs';

// modules/translator JS surface (types only — the native module lives in T2)
export { PAIR_STATUSES } from './module';
export type {
  DownloadPackOptions,
  PairStatus,
  TranslateResult,
  TranslationAvailability,
  TranslatorModuleApi,
} from './module';
