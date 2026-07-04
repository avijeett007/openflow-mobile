import { z } from 'zod';

/**
 * Persisted settings schema (zod). Mirrors the desktop OpenFlow model.
 *
 * SECURITY INVARIANT: this schema NEVER contains API keys. Only `apiKeyRef`
 * names are persisted; the actual secret lives in platform secure storage
 * (iOS Keychain / Android EncryptedSharedPreferences) keyed by that ref.
 */

// ---- STT ------------------------------------------------------------------

/** v1 supports remote providers and self-hosted (custom baseUrl) endpoints. */
export const SttModeSchema = z.enum(['remote', 'selfHosted']);
export type SttMode = z.infer<typeof SttModeSchema>;

export const SttProviderSchema = z.enum(['groq', 'openai', 'deepgram', 'custom']);
export type SttProvider = z.infer<typeof SttProviderSchema>;

export const SttSettingsSchema = z.object({
  mode: SttModeSchema.default('remote'),
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

// ---- Root -----------------------------------------------------------------

export const SETTINGS_VERSION = 1 as const;

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION).default(SETTINGS_VERSION),
  stt: SttSettingsSchema.default(SttSettingsSchema.parse({})),
  cleanup: CleanupSettingsSchema.default(CleanupSettingsSchema.parse({})),
  prompts: z.array(PromptSchema).min(1).default(() => [defaultPrompt()]),
  privacyMode: PrivacyModeSchema.default('full'),
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
