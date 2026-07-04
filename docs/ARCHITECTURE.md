# OpenFlow Mobile — architecture (orchestrator-approved, evidence-grounded)

Repo: `avijeett007/openflow-mobile` (public, MIT, empty at start). Mobile sibling of
OpenFlow desktop: voice-dictation KEYBOARD for iOS + Android + companion app.
Full research citations live in the design agent's report; this is the build spec.

## Non-negotiable platform facts (researched, cited in report)
- **iOS keyboard extensions CANNOT access the microphone** (sandbox, no entitlement
  overrides it; unchanged through iOS 18/26). Full Access grants network + App Group
  only. Recording MUST happen in the container app.
- **iOS 18 broke programmatic openURL from keyboards** — the mic button must be a
  SwiftUI `Link` (user-initiated tap) opening a custom URL scheme. Never call
  openURL via responder-chain tricks.
- **The approved iOS pattern (Wispr Flow, Gboard)** is the container-app hop:
  keyboard Link → `openflow://dictate?rid=<uuid>` → app foregrounds, records,
  STT+cleanup, writes `{rid, cleanedText, status}` to the App Group → user taps the
  system "‹ back" breadcrumb → keyboard reads App Group, `textDocumentProxy.insertText`.
- **Android IME records directly** (`RECORD_AUDIO` + `AudioRecord` inside the
  InputMethodService) and inserts via `InputConnection.commitText(text, 1)`. No hop.
  Android is the flagship experience.
- **v1 exclusions:** wake word / hands-free background listening (not viable/approvable
  on mobile — tap-to-talk only), on-device local STT (v2).

## Identifiers (FINAL — store IDs are permanent)
- iOS bundle id: `computer.openflow.mobile`; keyboard ext: `computer.openflow.mobile.keyboard`
- Android applicationId/package: `computer.openflow.mobile`
- App Group: `group.computer.openflow.mobile`
- Keychain access group: `$(AppIdentifierPrefix)computer.openflow.mobile.shared`
- URL scheme: `openflow://` (route `dictate`)
- App display name: **OpenFlow** (keyboard: "OpenFlow Keyboard")

## Stack (decided)
- **Expo SDK 53+ / React Native, TypeScript**, managed workflow + `npx expo prebuild`
  (CNG). Native dirs (`ios/`, `android/` generated) are NOT committed; native code is
  authored in `targets/` (iOS, via `@bacons/apple-targets` a.k.a. expo-apple-targets)
  and `plugins/` (Android IME config plugin injecting the `<service>`, `method.xml`,
  RECORD_AUDIO/INTERNET permissions, and Kotlin source copy step).
- **shared/** pure-TS core (zero RN imports): STT clients (OpenAI-compatible
  multipart `/v1/audio/transcriptions`; Deepgram adapter batch; custom endpoint),
  cleanup client (`/v1/chat/completions` for Groq/OpenAI/OpenRouter/custom/Ollama),
  zod settings schema (STT mode ⟂ cleanup mode, prompts, privacy), history record
  types + analytics reducers, prompt assembly. 100% unit-testable on this Mac.
- Secrets: iOS Keychain (shared access group) via expo-secure-store where possible in
  the app + Swift Keychain read in the extension is NOT needed (extension never
  networks); Android EncryptedSharedPreferences (same UID as IME — no cross-app issue).
  NON-secret settings + result hand-off: App Group UserDefaults (iOS) / same-package
  storage (Android).
- Kotlin IME networking: mirror the tiny HTTP surface (2 endpoints) in Kotlin,
  contract-tested against shared/ fixtures (JS-in-IME complexity avoided in v1).

## Dictation flows
- iOS: keyboard Link → app records (AVAudioEngine 16kHz mono m4a) → STT → cleanup →
  App Group write + history row → user taps breadcrumb → keyboard inserts. Status
  chip on keyboard driven by App Group status (recording/transcribing/cleaning/ready).
  Errors: shown in app with retry / insert-raw-transcript. Whole-clip upload v1.
- Android: IME mic press-and-hold or tap-to-toggle → AudioRecord 16kHz mono →
  Kotlin HTTP → STT → cleanup → commitText. Inline status in keyboard view. Errors
  inline with retry / insert-raw.

## CI (GitHub Actions, zero paid accounts)
- `ci.yml` (ubuntu): shared/ + app/ tsc, eslint, jest.
- `android.yml` (ubuntu): `expo prebuild -p android` → `./gradlew assembleDebug` →
  upload debug APK artifact.
- `ios.yml` (macos-15): `expo prebuild -p ios` → `xcodebuild -sdk iphonesimulator
  CODE_SIGNING_ALLOWED=NO` (app + keyboard target) → upload sim .app artifact.
- EAS documented as the OPTIONAL signed path once the user adds Apple/Google accounts.

## Repo layout
```
app/            Expo app source (screens, record flow, deep-link handler)
shared/         pure-TS core + tests (workspace package @openflow/shared)
targets/        iOS keyboard extension (Swift) for expo-apple-targets
plugins/        Expo config plugins (Android IME injection, iOS extras)
android-ime/    Kotlin IME sources copied into prebuild by the plugin
docs/           ARCHITECTURE.md, STORE-SUBMISSION.md, PRIVACY-POLICY.md drafts
.github/workflows/
```

## Store-readiness pre-baked (no accounts): RequestsOpenAccess=YES + privacy copy,
NSMicrophoneUsageDescription (container), PrivacyInfo.xcprivacy, Play Data Safety
draft, nutrition-label draft, privacy policy template (data goes only to
user-configured endpoints; history stays on device). Needs user: Apple $99/yr,
Play $25, then `eas build` or documented manual signing.

## Build chunks
C1 scaffold+shared core (blocks all) → C2 app / C3 iOS keyboard+targets / C4 Android
IME+plugin (parallel, disjoint dirs; app.config.ts pre-wired in C1 so no collisions)
→ C6 CI → C7 docs → verify in CI → v0.1.0.

## Feature parity vs desktop
Same three-backend concept (minus local v1), independent STT/cleanup, custom prompts,
on-device history + simple analytics, privacy modes, OpenFlow branding (violet
#7C5CFF, wordmark), MIT, contributions-not-accepted policy, links: openflow.computer,
hello@openflow.computer, buymeacoffee.com/kno2gether, knotie.ai credit.
