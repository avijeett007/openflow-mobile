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
SttSettings     { mode: 'local'|'remote'|'selfHosted', provider: 'groq'|'openai'|'deepgram'|'custom',
                  baseUrl?: string, model: string, apiKeyRef: string }
CleanupSettings { enabled: boolean, provider: 'groq'|'openai'|'openrouter'|'ollama'|'custom',
                  baseUrl?: string, model: string, apiKeyRef: string, promptId: string }
Prompt          { id: string, name: string, prompt: string }
PrivacyMode     'full' | 'keywordsOnly' | 'off'
Settings        { version: 1, stt, cleanup, prompts: Prompt[], privacyMode }
```

**STT `mode`** (additive, `SETTINGS_VERSION` unchanged at `1`):
- `local` — on-device platform recognizer (iOS `SFSpeechRecognizer`, Android
  `SpeechRecognizer`). No API key, no network. When `mode === 'local'` the
  `provider` / `baseUrl` / `model` / `apiKeyRef` fields are **irrelevant**; the
  schema still fills them from defaults so a `{ mode: 'local' }` payload parses
  and the persisted shape stays stable for the **Kotlin IME mirror** (the IME's
  only contract is `stt.mode === "local"`). Cleanup is unchanged and still runs
  in local mode if the user enabled it.
- `remote` — hosted provider over the network (default).
- `selfHosted` — user-hosted OpenAI-compatible endpoint (custom `baseUrl`).

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

### Offline Translator core (`src/translator/`, chunk T1)
Pure-TS heart of the Live Translation tab. FROZEN contract for chunk T2
(`modules/translator` natives) and T3 (Translator UI) — both import ONLY from
`@openflow/shared`.

**Conversation state machine** (`conversation.ts`):
- `Side` `'a' | 'b'`, `otherSide(side)`, `TurnStatus`
  `'idle'|'listening'|'translating'|'showing'|'speaking'|'error'`.
- `interface Exchange { id, ts, side, sourceLang, targetLang, sourceText, translatedText, detectedLang?, spoken }`.
- `ConversationState` / `ConversationAction` + `conversationReducer` (exhaustive
  switch), `initialConversationState(opts?)`, `HISTORY_CAP = 50`, `DEFAULT_LANGS`.
- Semantics: `MIC_TAP` on the **other** side while listening cancels + restarts
  listening there; same-side tap while listening is a no-op (the hook stops STT
  → `STT_FINAL`); taps are ignored while `translating`. Empty `STT_FINAL` →
  `idle` (no turn). `TRANSLATED` prepends its `Exchange` to `history` (newest
  first, capped 50). Errors are per-turn and NON-fatal (history survives; any
  tap recovers). `SWAP_LANGS` / `SET_LANG` apply only outside an active turn
  (idle/showing/error) and are ignored mid-turn. `SPEAK_START` is gated:
  `showing` + `speakEnabled` + a current exchange, and marks it `spoken`.
  Stale async results (`STT_PARTIAL`/`STT_FINAL`/`TRANSLATED` in the wrong
  status) are dropped by the reducer.

**Pack tracking** (`packs.ts`):
- `PackState 'installed'|'downloadable'|'downloading'|'unsupported'`
  (`downloading` is client-side; the module only reports `PairStatus`),
  `PACK_STATES`, `PackMap`, `initialPackMap`, `getPackState(map, lang)`
  (alias-tolerant), `packReducer` with `SYNC` / `DOWNLOAD_START` /
  `DOWNLOAD_DONE` / `DOWNLOAD_FAILED` / `PACK_DELETED`. `SYNC` rebuilds from
  `listSupportedLanguages()` + `listDownloadedLanguages()`, preserves in-flight
  downloads, matches alias spellings (iw↔he, nb-NO↔no, fil↔tl) and keeps
  Apple's region/script variants (en-GB vs en-US, zh-Hans vs zh-Hant) distinct.

**Language mapping** (`langs.ts`):
- `bcp47Primary`, `canonicalPrimary` (+ `PRIMARY_ALIASES`: iw→he, in→id, ji→yi,
  tl→fil, nb→no, mo→ro), `langKey` (script-aware for Chinese: zh-CN→zh-hans,
  zh-TW→zh-hant), `fullLangKey`.
- `toTranslationLang(tag, available)` — maps any STT locale onto the platform's
  translation list (exact → language+script → primary tiers; returns codes FROM
  the list, `null` if unsupported). `pickSttLocale(lang, sttLocales)` is the
  reverse. `displayLanguageName(code)` (Intl.DisplayNames with
  `FALLBACK_DISPLAY_NAMES` for ICU-less Hermes).
- `computeUsable(sttLocales, translationLangs, packStates): UsableLang[]` —
  the picker list: `{ lang, displayName, sttLocale, sttKnown, pack, usable }`,
  usable ⇔ pack installed ∧ STT locale exists (STT unknown when `sttLocales`
  is `null`); sorted ready → installed-no-STT → downloading → downloadable.
- Pinned platform lists: [`fixtures/langs-mlkit.json`](./fixtures/langs-mlkit.json)
  (ML Kit, 59 codes) and [`fixtures/langs-apple.json`](./fixtures/langs-apple.json)
  (Apple iOS 18, 21 codes) — mapping tests run against both.

**`modules/translator` JS surface** (`module.ts`, types only):
- `interface TranslatorModuleApi` — `translate`, `getPairStatus`,
  `downloadPack`, `listSupportedLanguages`, `listDownloadedLanguages`,
  `deletePack`, `identifyLanguage`, `sttOnDeviceLocales`,
  `isTranslationAvailable` (see DESIGN-mobile-translator.md for exact
  signatures). Plus `PairStatus` (+ `PAIR_STATUSES`), `TranslateResult`,
  `DownloadPackOptions`, `TranslationAvailability`. T2 implements this
  interface; T3 consumes it through T2's defensive loader.

**Settings** (additive; `SETTINGS_VERSION` stays `1`, Kotlin IME untouched):
- `TranslatorSettingsSchema` → `Settings.translator`:
```ts
TranslatorSettings { langs: { a: string, b: string },   // defaults en / es
                     speakEnabled: boolean,             // default true
                     autoDetect: boolean,               // default false
                     wifiOnlyDownloads: boolean }       // default true (Android ML Kit)
```
Payloads without `translator` parse and gain the defaults (additive migration).

## Testing
`npm test` (jest, ts-jest, node). Every export is covered; provider request shapes
and canned responses are pinned in [`fixtures/`](./fixtures) and bound to the clients
by `src/fixtures.test.ts` for the Kotlin mirror. Translator language mapping is
pinned to both platforms' language lists in `fixtures/langs-*.json`.
