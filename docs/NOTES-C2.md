# C2 — Companion app: build notes & handoff

Chunk C2 delivers the Expo companion app (`app/`, `src/`). This file records the
things the **orchestrator** and the parallel native agents (C3 iOS keyboard, C4
Android IME) need, because C2 may not touch `app.config.ts`, `plugins/`,
`targets/`, `android-ime/`, `shared/`, or `.github/`.

## 1. `app.config.ts` changes needed (orchestrator to apply)

C2 could not edit `app.config.ts`. Please add:

1. **Expo module config plugins** to the `plugins` array:
   ```ts
   plugins: [
     './plugins/withAndroidIme',
     'expo-audio',        // adds RECORD_AUDIO (Android) + wires NSMicrophoneUsageDescription (iOS)
     'expo-secure-store', // Keychain / Keystore access; optional Face ID prompt string
     // C3 will also add '@bacons/apple-targets' here.
   ]
   ```
   `npx expo install` printed exactly this reminder. The container app records
   audio (both for its own Dictate screen and the iOS hop), so `expo-audio`'s
   permission wiring is required. `NSMicrophoneUsageDescription` is already set
   manually in `ios.infoPlist`; the `expo-audio` plugin can also manage it —
   keep one source to avoid a duplicate-key prebuild warning.

2. **URL scheme** is already `openflow` (good). No change needed — the `dictate`
   route is parsed in JS (`src/App.tsx`), not via a navigation linking config.

Nothing else in `app.config.ts` is required by C2.

## 2. Native wiring TODOs (C3 iOS / C4 Android)

C2 talks to the native shared storage through ONE thin, defensively-loaded
interface: `src/lib/settingsBridge.ts`. It is a no-op (with a single
`console.warn`) until the natives exist, so the app already runs in Expo Go / CI.

The bridge reads/writes these string keys; **mirror these exact key names**:

| Purpose            | Key                              | Value                                  |
| ------------------ | -------------------------------- | -------------------------------------- |
| Settings mirror    | `openflow.settings`              | secret-free settings JSON (shared `serializeSettings`) |
| Secret mirror      | `openflow.secret.<apiKeyRef>`    | raw API key string                     |
| iOS hand-off       | `openflow.handoff.<rid>`         | `encodeHandoff()` JSON (shared codec)  |

- **iOS (C3):** C2 tries `require('@bacons/apple-targets').ExtensionStorage`,
  constructed with app group `group.computer.openflow.mobile`, calling
  `.set(key, value)` / `.get(key)`. If your ExtensionStorage API differs
  (constructor args, method names), tell C2 or tweak
  `getIosExtensionStorage()`; the shape is isolated to that one function. The
  keyboard extension reads `openflow.handoff.<rid>` back after the user taps the
  system "‹ Back" breadcrumb and inserts `text` via `textDocumentProxy`.
- **Android (C4):** C2 tries `requireOptionalNativeModule('settings-bridge')`
  exposing `setItem(key, value)` / `getItem(key)`. The IME reads
  `openflow.settings` + `openflow.secret.<ref>` from the same-package store.
  Android records in the IME itself (no hop), so it does not use the handoff key.

Hand-off JSON is the frozen shared shape (`{ rid, status, text?, error? }`); the
Swift side mirrors it verbatim (already noted in `shared/handoff`).

## 3. Dependencies added by C2 (all JS / Expo-managed, no native authoring)

Runtime:
- `expo-audio` (~0.4.9) — in-app recording (16 kHz mono m4a)
- `expo-secure-store` (~14.2.4) — API-key storage
- `@react-native-async-storage/async-storage` (2.1.2) — settings/history/onboarding
- `expo-file-system` (~18.1.11) — read recorded clip bytes
- `expo-clipboard` (~7.1.5) — Copy button
- `expo-linking` (~7.1.7) — `openflow://dictate?rid=` parsing
- `expo-constants` (~17.1.8) — version in About
- `@react-navigation/native` (^7) + `@react-navigation/bottom-tabs` (^7)
- `react-native-screens`, `react-native-safe-area-context` (Expo-managed native, no plugin edits)

Dev:
- `jest-expo` (~53), `react-test-renderer` (19.0.0, pinned), `@testing-library/react-native` (^13),
  `@types/react-test-renderer`

Removed after evaluation (kept deps lean): `@react-navigation/native-stack`,
`expo-haptics` (unused).

## 4. Judgment calls

- **Navigation: react-navigation (bottom tabs), NOT expo-router.** expo-router
  requires its config plugin + a changed entry in `app.config.ts`/`index.js`
  wiring that C2 must not touch. react-navigation is wired purely in JS.
- **Recording: expo-audio, not expo-av.** expo-av is deprecated in SDK 53.
  expo-audio's whole-clip recorder is sufficient for v1. Wrapped behind
  `DictationRecorder` (`src/lib/recorder.ts`) so the state machine tests inject a
  fake. If expo-audio recording proves flaky on device, swapping the recorder
  impl is a one-file change.
- **Deep-link hop handled at the app root** (`src/App.tsx` `useHopRid`) as a
  full-screen takeover, rather than a navigation linking config — simpler and
  robust regardless of onboarding state.
- **Onboarding is a 3-step local component** (`OnboardingFlow.tsx`), not a nested
  navigator — less machinery for a linear flow.
- **STT "Test" button uses a synthetic in-memory WAV** (16 kHz mono silence,
  `src/lib/sampleAudio.ts`) instead of a bundled binary asset or a live mic
  recording. It proves auth + connectivity + response shape; the transcript is
  expected to be empty.
- **History flag:** shared `HistoryRecord` is frozen, so the raw-only/cleanup-
  failed marker lives on a structural extension `AppHistoryRecord`
  (`HistoryRecord & { cleanupFailed?: boolean }`) — still assignable to
  `computeAnalytics(HistoryRecord[])`.
- **Testing:** bare `react-test-renderer@19` returns `null` trees for RN host
  components (React 19 needs act-wrapped rendering), so component smoke tests use
  `@testing-library/react-native`. All logic (state machine, stores, hop reducer,
  codecs, test-connection) is dependency-injected and RN-free.
- **`npm run test` at the repo root now runs shared AND the app** (`... && jest`).
  App Jest config is `jest.config.js` (`jest-expo` preset, `roots: src`).

## 5. Formatting caveat (pre-existing)

`npm run format` (prettier --check) reports failures in files that predate C2
(`shared/**`, `docs/ARCHITECTURE.md`, `plugins/README.md`, `targets/README.md`,
etc.). C2 did not modify those. All C2-authored files under `src/`, `app/App.tsx`,
`jest.setup.ts`, `jest.config.js` are prettier-clean. If CI gates on `format`,
the orchestrator may want a repo-wide `prettier --write` in a separate chore.

## 6. Verification (from worktree)

- `npm run typecheck` — clean (shared + app)
- `npm run lint` — clean
- `npm run test` — shared 44/44, app 25/25 green
- `npx expo config --type public` — parses
- `npx expo export --platform ios` — Metro bundles 879 modules successfully
  (validates the full module graph; web export skipped — needs react-dom /
  react-native-web which a mobile app should not pull in).
