# plugins/ — Expo config plugins

Config plugins that inject native configuration during `expo prebuild` (CNG).
The generated `ios/` and `android/` projects are **not** committed.

## Current
- **`withAndroidIme.js`** — Android IME injection. Currently a **no-op passthrough
  stub** (chunk C1) so `expo config` / prebuild stay valid and later agents have a
  stable plugin entry to extend without collisions. Chunk **C4** implements it:
  RECORD_AUDIO / INTERNET permissions, the IME `<service>` registration,
  `method.xml`, and the Kotlin source copy step from `android-ime/`.

## TODO (later chunks)
- iOS extras (chunk C3) are handled via `@bacons/apple-targets` and
  `targets/expo-target.config.js` rather than a plugin here; a small iOS plugin
  may be added if App Group / Keychain entitlements need to be applied to the
  main app target.
