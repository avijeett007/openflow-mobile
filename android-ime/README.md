# android-ime/ — Kotlin IME sources (placeholder)

**Owner: chunk C4 (Android IME + config plugin).**

This directory will hold the **Kotlin InputMethodService** sources for the
OpenFlow Android keyboard. The `plugins/withAndroidIme.js` config plugin copies
these into the generated Android project during `expo prebuild -p android`
(the native `android/` project is **not** committed).

## What goes here (C4)
- `OpenFlowImeService.kt` — `InputMethodService` that:
  - records directly via `AudioRecord` (16 kHz mono) on mic press-and-hold / tap-to-toggle,
  - calls STT then cleanup over HTTP (Kotlin mirror of the `@openflow/shared` surface),
  - inserts text via `InputConnection.commitText(text, 1)`,
  - shows inline status + retry / insert-raw on error.
- `res/xml/method.xml` — IME metadata.
- HTTP client mirroring the two endpoints (`/audio/transcriptions`,
  `/chat/completions`, plus Deepgram `/v1/listen`).

## Contract
The Kotlin HTTP client MUST match the request/response shapes pinned in
[`shared/fixtures/`](../shared/fixtures) (contract-tested in TS by
`shared/src/fixtures.test.ts`). Secrets live in `EncryptedSharedPreferences`
(same UID as the IME). See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
