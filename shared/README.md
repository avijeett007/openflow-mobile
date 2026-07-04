# @openflow/shared

Pure-TypeScript core for OpenFlow Mobile. **Zero React Native imports** — runs
under plain node/Jest. This is the **FROZEN public API** consumed by the Expo app
(chunk C2) and mirrored by the Kotlin IME HTTP layer (chunk C4). Treat the surface
below as a stable contract: additive changes only.

## Install / import

```ts
import { transcribe, cleanTranscript, defaultSettings } from '@openflow/shared';
```

Secrets are NEVER passed through settings. Callers resolve the secret from
platform secure storage (Keychain / EncryptedSharedPreferences) using the
`apiKeyRef` name and pass it as the `apiKey` argument.

## Public API

### Errors
- `class OpenFlowError extends Error` — base class.
- `class AuthError` — 401/403; has `status`.
- `class EndpointError` — other HTTP/parse failures; has `status`, `bodySnippet`.
- `class ConfigError` — invalid/incomplete settings.
- `throwForResponse(res, context): Promise<never>` — maps a failed `Response` to the right error.

### Settings (zod)
- Schemas: `SettingsSchema`, `SttSettingsSchema`, `SttModeSchema`, `SttProviderSchema`,
  `CleanupSettingsSchema`, `CleanupProviderSchema`, `PromptSchema`, `PrivacyModeSchema`.
- `SETTINGS_VERSION = 1`.
- `defaultSettings(): Settings`
- `defaultPrompt(): Prompt`, `defaultPrompts(): Prompt[]`
- `parseSettings(input): Settings` (throws `ConfigError`)
- `safeParseSettings(input): { ok, settings } | { ok, error }`
- `migrateSettings(input): Settings` — version-coerce + fill defaults; drops leaked secrets.
- `serializeSettings(settings): Settings` — persist boundary (never emits secrets).
- Types: `Settings`, `SttSettings`, `SttMode`, `SttProvider`, `CleanupSettings`,
  `CleanupProvider`, `Prompt`, `PrivacyMode`.

Shapes:
```ts
SttSettings     { mode: 'remote'|'selfHosted', provider: 'groq'|'openai'|'deepgram'|'custom',
                  baseUrl?: string, model: string, apiKeyRef: string }
CleanupSettings { enabled: boolean, provider: 'groq'|'openai'|'openrouter'|'ollama'|'custom',
                  baseUrl?: string, model: string, apiKeyRef: string, promptId: string }
Prompt          { id: string, name: string, prompt: string }
PrivacyMode     'full' | 'keywordsOnly' | 'off'
Settings        { version: 1, stt, cleanup, prompts: Prompt[], privacyMode }
```

### STT
- `transcribe(opts): Promise<{ text: string }>`
  - `opts: { settings: SttSettings, audio: { bytes: Uint8Array, mimeType, fileName }, apiKey: string, fetchImpl?: typeof fetch }`
  - Groq/OpenAI/custom → OpenAI-compatible multipart `POST {base}/audio/transcriptions`.
  - Deepgram → `POST {base}/v1/listen?model=&smart_format=true` with raw bytes + `Token` auth.
- Types: `TranscribeOptions`, `TranscribeResult`, `SttAudio`.

Default bases: groq `https://api.groq.com/openai/v1`, openai `https://api.openai.com/v1`,
deepgram `https://api.deepgram.com`. `custom` requires `baseUrl`.

### Cleanup
- `cleanTranscript(opts): Promise<{ text: string }>`
  - `opts: { settings: CleanupSettings, transcript: string, apiKey: string, prompts?: Prompt[], fetchImpl?: typeof fetch }`
  - `POST {base}/chat/completions` (OpenAI-compatible) with `system`+`user` messages.
  - Ollama base `http://localhost:11434/v1`; when `apiKey` is empty the `Authorization` header is omitted.
- `resolvePrompt(promptId, prompts?): Prompt`, `assembleCleanupMessages(promptText, transcript): ChatMessage[]`.
- Types: `CleanupOptions`, `CleanupResult`, `ChatMessage`.

Default bases: groq/openai as above, openrouter `https://openrouter.ai/api/v1`.
`custom` requires `baseUrl`.

### History + analytics
- `interface HistoryRecord { id, ts, appContext?, rawText?, cleanedText?, wordCount, durationMs, sttProvider, cleanupProvider?, privacyMode }`
- `applyPrivacy(record, mode): HistoryRecord` — `keywordsOnly` nulls text (keeps metadata); `off` also nulls `appContext`.
- `computeAnalytics(records): Analytics` — `{ totalWords, dictationCount, avgWordsPerDictation, estimatedSecondsSaved, sttProviderCounts, cleanupProviderCounts }`.
- `countWords(text): number`, `TYPING_WPM = 40` (baseline for time-saved estimate).

### iOS App-Group hand-off codec
- `interface DictationHandoff { rid: string, status: 'recording'|'transcribing'|'cleaning'|'ready'|'error', text?, error? }`
- `encodeHandoff(h): string`, `decodeHandoff(s): DictationHandoff` (throws `HandoffDecodeError`).
- `DictationHandoffSchema`, `DictationStatusSchema` (zod). JSON is flat & stable — the Swift side mirrors it verbatim.

## Testing
`npm test` (jest, ts-jest, node). Every export is covered; provider request shapes
and canned responses are pinned in [`fixtures/`](./fixtures) and bound to the clients
by `src/fixtures.test.ts` for the Kotlin mirror.
