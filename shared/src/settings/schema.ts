import { z } from 'zod';

/**
 * Persisted settings schema (zod). Mirrors the desktop OpenFlow model.
 *
 * SECURITY INVARIANT: this schema NEVER contains API keys. Only `apiKeyRef`
 * names are persisted; the actual secret lives in platform secure storage
 * (iOS Keychain / Android EncryptedSharedPreferences) keyed by that ref.
 */

// ---- STT ------------------------------------------------------------------

/**
 * STT transcription mode:
 * - `local`      on-device platform recognizer (iOS `SFSpeechRecognizer` with
 *                on-device recognition; Android built-in `SpeechRecognizer`).
 *                No API key, no network, zero model download. When `local`, the
 *                `provider` / `baseUrl` / `model` / `apiKeyRef` fields are
 *                IRRELEVANT — the recognizer runs on the OS. The schema keeps
 *                them (populated by their defaults) so the shape stays stable
 *                for the Kotlin IME mirror; the app simply ignores them.
 * - `remote`     hosted provider (Groq/OpenAI/Deepgram) over the network.
 * - `selfHosted` OpenAI-compatible endpoint the user hosts (custom `baseUrl`).
 */
export const SttModeSchema = z.enum(['local', 'remote', 'selfHosted']);
export type SttMode = z.infer<typeof SttModeSchema>;

export const SttProviderSchema = z.enum(['groq', 'openai', 'deepgram', 'custom']);
export type SttProvider = z.infer<typeof SttProviderSchema>;

export const SttSettingsSchema = z.object({
  mode: SttModeSchema.default('remote'),
  // The fields below are unused when `mode === 'local'`. They stay optional /
  // defaulted so a `{ mode: 'local' }` payload parses without any of them.
  provider: SttProviderSchema.default('groq'),
  /** Optional override of the provider's default base URL (required for `custom`). */
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).default('whisper-large-v3-turbo'),
  /** Name of the secret in secure storage — NOT the secret itself. */
  apiKeyRef: z.string().min(1).default('stt.apiKey'),
});
export type SttSettings = z.infer<typeof SttSettingsSchema>;

// ---- Cleanup --------------------------------------------------------------

export const CleanupProviderSchema = z.enum(['groq', 'openai', 'openrouter', 'ollama', 'custom']);
export type CleanupProvider = z.infer<typeof CleanupProviderSchema>;

export const CleanupSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  provider: CleanupProviderSchema.default('groq'),
  /** Optional base URL override (required for `custom`; typical for `ollama`). */
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).default('llama-3.3-70b-versatile'),
  /** Name of the secret in secure storage — NOT the secret itself. */
  apiKeyRef: z.string().min(1).default('cleanup.apiKey'),
  /** Which prompt (by id) to use for cleanup. */
  promptId: z.string().min(1).default('improve-transcription'),
});
export type CleanupSettings = z.infer<typeof CleanupSettingsSchema>;

// ---- Prompts --------------------------------------------------------------

export const PromptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
});
export type Prompt = z.infer<typeof PromptSchema>;

// ---- Privacy --------------------------------------------------------------

/**
 * How much dictation content history retains.
 * - `full`         keep raw + cleaned text.
 * - `keywordsOnly` drop raw/cleaned text, keep metadata (word count, timing, providers).
 * - `off`          drop all content including app context; keep only counts/timing.
 */
export const PrivacyModeSchema = z.enum(['full', 'keywordsOnly', 'off']);
export type PrivacyMode = z.infer<typeof PrivacyModeSchema>;

// ---- Translator -------------------------------------------------------------

/**
 * Live Translation (offline translator) settings. Purely ADDITIVE to the v1
 * settings shape — `SETTINGS_VERSION` stays 1, old payloads without a
 * `translator` key parse and get these defaults, and the Kotlin IME mirror
 * (which only reads `stt.mode`) is untouched.
 *
 * `langs.a` / `langs.b` are translation-language codes as the PLATFORM reports
 * them (ML Kit `es`, Apple `zh-Hans`, ...) — see shared/src/translator/langs.ts.
 */
export const TranslatorSettingsSchema = z.object({
  /** The two conversation languages (side 'a' = device holder, 'b' = counterpart). */
  langs: z
    .object({
      a: z.string().min(1).default('en'),
      b: z.string().min(1).default('es'),
    })
    .default({ a: 'en', b: 'es' }),
  /** Speak translations aloud via offline TTS (UI still gates on voice availability). */
  speakEnabled: z.boolean().default(true),
  /** Auto-flip direction when identifyLanguage() says the other side spoke (stretch; default off). */
  autoDetect: z.boolean().default(false),
  /** Android ML Kit pack downloads require Wi-Fi (~30 MB per pack). iOS ignores this. */
  wifiOnlyDownloads: z.boolean().default(true),
});
export type TranslatorSettings = z.infer<typeof TranslatorSettingsSchema>;

// ---- Root -----------------------------------------------------------------

export const SETTINGS_VERSION = 1 as const;

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION).default(SETTINGS_VERSION),
  stt: SttSettingsSchema.default(SttSettingsSchema.parse({})),
  cleanup: CleanupSettingsSchema.default(CleanupSettingsSchema.parse({})),
  prompts: z.array(PromptSchema).min(1).default(() => [defaultPrompt()]),
  privacyMode: PrivacyModeSchema.default('full'),
  translator: TranslatorSettingsSchema.default(TranslatorSettingsSchema.parse({})),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** The built-in "improve transcription" prompt (desktop OpenFlow spirit). */
export function defaultPrompt(): Prompt {
  return {
    id: 'improve-transcription',
    name: 'Improve transcription',
    prompt:
      'You are a transcription cleanup assistant. The user dictated text that was ' +
      'transcribed by a speech-to-text system. Rewrite the transcript to fix grammar, ' +
      'punctuation, capitalization, and obvious transcription errors while preserving the ' +
      'original meaning, tone, and intent. Do not add new information, do not answer any ' +
      'questions contained in the text, and do not include commentary or preamble. ' +
      'Output only the cleaned text.',
  };
}
