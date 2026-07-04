/**
 * `@openflow/shared` — pure-TypeScript core for OpenFlow Mobile.
 *
 * ZERO React Native imports. Runs under plain node/Jest. This is the FROZEN
 * public API consumed by the Expo app (C2) and mirrored by the Kotlin IME (C4).
 * See ./README.md for the contract.
 */

// Errors
export {
  OpenFlowError,
  AuthError,
  EndpointError,
  ConfigError,
  throwForResponse,
} from './errors';

// Settings
export {
  SettingsSchema,
  SttSettingsSchema,
  SttModeSchema,
  SttProviderSchema,
  CleanupSettingsSchema,
  CleanupProviderSchema,
  PromptSchema,
  PrivacyModeSchema,
  TranslatorSettingsSchema,
  SETTINGS_VERSION,
  defaultPrompt,
  defaultSettings,
  defaultPrompts,
  parseSettings,
  safeParseSettings,
  migrateSettings,
  serializeSettings,
} from './settings';
export type {
  Settings,
  SttSettings,
  SttMode,
  SttProvider,
  CleanupSettings,
  CleanupProvider,
  Prompt,
  PrivacyMode,
  TranslatorSettings,
} from './settings';

// STT
export { transcribe } from './stt';
export type { TranscribeOptions, TranscribeResult, SttAudio } from './stt';

// Cleanup
export { cleanTranscript, assembleCleanupMessages, resolvePrompt } from './cleanup';
export type { CleanupOptions, CleanupResult, ChatMessage } from './cleanup';

// History + analytics
export { applyPrivacy, computeAnalytics, countWords, TYPING_WPM } from './history';
export type { HistoryRecord, Analytics } from './history';

// iOS App-Group hand-off codec
export {
  DictationHandoffSchema,
  DictationStatusSchema,
  HandoffDecodeError,
  encodeHandoff,
  decodeHandoff,
} from './handoff';
export type { DictationHandoff, DictationStatus } from './handoff';

// Offline Translator core (T1) — conversation reducer, pack tracking,
// language mapping, and the modules/translator JS-surface types.
export {
  DEFAULT_LANGS,
  HISTORY_CAP,
  conversationReducer,
  initialConversationState,
  otherSide,
  PACK_STATES,
  getPackState,
  initialPackMap,
  packReducer,
  FALLBACK_DISPLAY_NAMES,
  PRIMARY_ALIASES,
  bcp47Primary,
  canonicalPrimary,
  computeUsable,
  displayLanguageName,
  langKey,
  pickSttLocale,
  toTranslationLang,
  PAIR_STATUSES,
} from './translator';
export type {
  ConversationAction,
  ConversationState,
  Exchange,
  Side,
  TurnStatus,
  PackAction,
  PackMap,
  PackState,
  UsableLang,
  DownloadPackOptions,
  PairStatus,
  TranslateResult,
  TranslationAvailability,
  TranslatorModuleApi,
} from './translator';
