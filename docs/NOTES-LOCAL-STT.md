# Local (on-device) STT — build notes & handoff

Adds a third STT `mode`, **`local`**, that transcribes with the PLATFORM
on-device recognizers (iOS `SFSpeechRecognizer` with on-device recognition;
Android's built-in `SpeechRecognizer`). No API key, no network, zero model
download. Remote / self-hosted behavior is unchanged. Cleanup (LLM) remains
available in local mode if the user enabled it (their choice — the UI states the
privacy implication).

This work owns `shared/`, `src/`, `app.config.ts` (local-STT additions only),
and `package.json`. It does NOT touch `android-ime/`, `targets/`,
`plugins/withAndroidIme.js`, or `.github/`.

## 1. Contract with the parallel Kotlin IME agent — CONFIRMED STABLE

The IME's only contract with this side is the settings JSON field:

```json
{ "stt": { "mode": "local" } }
```

- `SttModeSchema` is now `z.enum(['local', 'remote', 'selfHosted'])` — purely
  **additive**. `SETTINGS_VERSION` stays `1` (no migration bump; a bare
  `{ stt: { mode: 'local' } }` parses because every other STT field already has a
  default).
- **No existing field changed name, type, shape, or default.** `provider`,
  `baseUrl`, `model`, `apiKeyRef` are still present (populated by defaults) when
  `mode === 'local'`; they are simply irrelevant in that mode. The persisted
  shape the IME mirrors is therefore unchanged for `remote`/`selfHosted` and only
  gains the new enum value.
- `serializeSettings` still emits no secrets. History rows written in local mode
  carry `sttProvider: "on-device"`.

## 2. Package decision: `expo-speech-recognition` (jamsch) — with evidence

**Chosen** over writing a bespoke `modules/local-stt` native wrapper. Evidence
gathered from the package README and, decisively, the **installed** type
declarations (`node_modules/expo-speech-recognition/build/*.d.ts`):

| Requirement | Evidence (installed v2.1.5, dist-tag `sdk-53`) |
| --- | --- |
| iOS **on-device** (`SFSpeechRecognizer`) | `ExpoSpeechRecognitionOptions.requiresOnDeviceRecognition?: boolean` — "Prevent device from sending audio over the network." |
| Android **offline** preference | `AndroidIntentOptions.EXTRA_PREFER_OFFLINE: boolean` (maps to `RecognizerIntent.EXTRA_PREFER_OFFLINE`); plus `requiresOnDeviceRecognition` selecting the on-device service. |
| Expo **SDK 53** config plugin | `app.plugin.js` `ConfigPlugin<{ microphonePermission?; speechRecognitionPermission?; androidSpeechServicePackages? }>`; dist-tag `sdk-53` → `2.1.5`. |
| Partial + final results | `addSpeechRecognitionListener("result", …)` → `{ isFinal: boolean; results: {transcript}[] }`; `interimResults` start option. |
| Control + availability | `start(options)`, `stop()`, `abort()`, `isRecognitionAvailable()`, `supportsOnDeviceRecognition()`, `getPermissionsAsync()`/`requestPermissionsAsync()`. |
| Permissions + Info.plist | plugin writes `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription`; Android manifest `<queries>` for the speech service. |

Version pin: installed via `expo-speech-recognition@sdk-53` → **`2.1.5`** (the
SDK-53 line; `latest`/`56.x` targets newer Expo SDKs).

A hand-rolled native module would duplicate all of this and require Swift/Kotlin
authoring + maintenance for zero added capability, so it was rejected.

## 3. Config changes made (`app.config.ts`)

Added ONE plugin entry (surgical):

```ts
[
  'expo-speech-recognition',
  {
    speechRecognitionPermission: '…on-device… without sending audio to any server.',
    microphonePermission: 'OpenFlow records your voice only while you are dictating, then transcribes it.',
  },
],
```

- `speechRecognitionPermission` → `NSSpeechRecognitionUsageDescription` (NEW key).
- **Mic-string caveat (important):** this plugin ALSO writes
  `NSMicrophoneUsageDescription` and, on plugin ordering, wins over `expo-audio`.
  Verified via `expo config`: without a `microphonePermission` prop it reverted
  to the generic default. We therefore pass the SAME OpenFlow mic copy `expo-audio`
  uses, so the honest string is preserved and single-valued (both plugins now
  resolve to the identical string — no duplicate-key conflict).
- `package.json`: `expo-speech-recognition` added to `dependencies`.

`npx expo config --type public` → exit 0; both Info.plist strings are the
OpenFlow copy. `npx expo export --platform ios` bundles the full module graph
(exit 0), confirming the new imports resolve under Metro.

## 4. Code map

- **`src/lib/localStt.ts`** — `LocalStt` wrapper. `createLocalStt(getModule?)`
  (injectable), exported singleton `localStt`, plus `runLocalSttTest()` for the
  Settings "Test" button (2 s live listen). STRICT on-device flags on `start`:
  `requiresOnDeviceRecognition: true` + `androidIntentOptions.EXTRA_PREFER_OFFLINE:
  true` + `iosTaskHint: 'dictation'`. `isAvailable()` gates on
  `isRecognitionAvailable() && supportsOnDeviceRecognition()` and returns a
  human reason on failure. The native module is loaded defensively
  (`loadSpeechModule()` try/catch) so the app still runs under Jest / Expo Go /
  web (there `isAvailable → { available:false }`). `stop()` resolves the
  accumulated transcript (mirrors the file recorder's `stop()` shape).
- **`src/hooks/useDictation.ts`** — extracted `finishDictation()` (cleanup +
  history + terminal state; shared by both paths). New `processLocalTranscript()`
  (no upload; records `ON_DEVICE_PROVIDER = "on-device"`) and `startLocalSession()`
  (availability → permission → live `start`, streaming interim text as `PARTIAL`
  actions). The hook branches on `settings.stt.mode === 'local'` in `start`/`stop`
  and cancels the recognizer on `reset` while listening. `processClip` (remote
  path) is behaviorally unchanged.
- **NO silent cloud fallback.** If on-device is unavailable or permission is
  denied, we emit `ERROR` and never call `recognizer.start()` — this is asserted
  by a test ("surfaces an availability error and does NOT start").
- **`src/hooks/useAppDictation.ts`** — passes the `localStt` singleton.
- **Settings + onboarding** — "Local (on-device) — free, private, no API key"
  listed FIRST in the STT mode picker, per-platform caveat copy
  (`strings.settings.localCaveat{Ios,Android}`), cleanup-in-local privacy note,
  and a "Test on-device recognition" button (permission request + 2 s listen →
  reports whether the recognizer produced anything, or the availability error).
- **iOS hop (`HopScreen`)** works identically: it drives `useAppDictation`, whose
  local branch streams status (`recording`/listening → `transcribing` →
  `cleaning?` → `ready`) to the App-Group hand-off exactly as before. Live
  partial text is shown on `HomeScreen` + `HopScreen` while listening.

## 5. Status flow (local)

`RECORD_START` (listening, partials stream) → user taps stop → recognizer
finalizes → `TRANSCRIBING` → `TRANSCRIBED` → `CLEANING` (only if cleanup enabled
AND a key resolves) → `READY`. Errors → `ERROR` (no history row). The existing
`DictationStatus` enum (`recording`/`transcribing`/`cleaning`/`ready`) is reused
so `MicButton`, `HopScreen`, and the hand-off codec need no changes.

## 6. Verification

- `npm run typecheck` — clean (shared + app).
- `npm run lint` — clean.
- `npm run test` — **shared 49/49** (was 44; +5 local-mode schema tests), **app
  43/43** (was 25; +18 across `localStt.test.ts` and local paths in
  `useDictation.test.ts`). Total **92/92**. All prior 69 still green.
- `npx expo config --type public` — parses; Info.plist speech + mic keys correct.
- `npx expo export --platform ios` — bundles the module graph (exit 0).

No native toolchain here, so on-device recognition itself is exercised only
through the injectable mock recognizer; real-device behavior needs an EAS/prebuild
run.

## 7. For the orchestrator

- Nothing more is required in `app.config.ts` for local STT.
- On a signed/prebuild path, the plugin adds the Android speech-service `<queries>`
  entry automatically; no `withAndroidIme.js` change is involved.
- The Kotlin IME's local-mode work only needs to read `stt.mode === "local"`;
  the settings shape it mirrors is otherwise untouched.
