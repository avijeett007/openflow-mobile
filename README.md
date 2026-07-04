<h1 align="center"><span style="color:#7C5CFF">Open</span>Flow</h1>

<p align="center">Voice dictation keyboard for iOS &amp; Android — your speech, your choice of AI backends.</p>

<p align="center">
  <a href="https://openflow.computer"><strong>openflow.computer</strong></a> ·
  <a href="https://github.com/avijeett007/openflow"><strong>OpenFlow desktop</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey" alt="Platform: iOS | Android"/>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"/>
  <img src="https://img.shields.io/badge/built%20with-Expo-000020" alt="Built with Expo"/>
</p>

## What it is

OpenFlow Mobile is the mobile sibling of [OpenFlow desktop](https://github.com/avijeett007/openflow): a
voice-dictation **keyboard** for iOS and Android, plus a companion app that holds your settings, API
keys, and on-device history. Speak instead of type — your audio is sent straight to the
speech-to-text provider **you** configure, optionally cleaned up by an LLM, then inserted into
whatever text field you're in.

The two platforms don't work identically, and we'd rather say so than pretend otherwise:

- **Android is the flagship experience.** The OpenFlow keyboard records audio directly inside the
  keyboard (an `InputMethodService` with `RECORD_AUDIO`) and inserts text the moment a result comes
  back. Nothing ever leaves the keyboard.
- **iOS keyboards cannot access the microphone.** This is an Apple sandbox restriction — no
  entitlement lifts it, and every dictation keyboard on iOS works around it the same way, including
  Wispr Flow. Tapping the mic in the OpenFlow keyboard hops you to the OpenFlow app (a plain
  user-initiated link, not a background trick), which records, transcribes, and cleans up your
  speech, then hands the text back to the keyboard the moment you switch back — a system "‹ Back"
  breadcrumb takes you there. It's one extra tap, not magic; we're not going to claim it's
  in-keyboard when it isn't.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical spec of both flows,
[`shared/README.md`](shared/README.md) for the shared TypeScript core, and
[`targets/keyboard/README.md`](targets/keyboard/README.md) for the iOS extension internals.

## Features

- **Independent STT and cleanup backends.** Pick your speech-to-text provider (Groq, OpenAI,
  Deepgram, or a custom OpenAI-compatible endpoint) completely independently of your cleanup
  provider (Groq, OpenAI, OpenRouter, Ollama, or custom). v1 targets **remote and self-hosted**
  endpoints only — no on-device/local STT yet (that's a v2 goal, and there's no wake-word /
  hands-free listening on mobile in v1 either; every dictation is a deliberate tap).
- **Your keys, your device.** API keys are stored in the iOS Keychain / Android
  `EncryptedSharedPreferences` — never in plaintext settings, never sent anywhere except the
  endpoint you configured them for.
- **On-device history and analytics.** Word counts, time-saved estimates, and per-provider usage
  are computed and stored locally. Nothing is uploaded to us — there is no "us" server in the loop.
- **Privacy modes.** Choose how much detail history keeps: full text, keywords-only, or off
  entirely.
- **Custom prompts.** Override the cleanup prompt globally, per-provider, or add your own.

## Status

**v0.1.0, pre-release.** CI builds are green for the shared TypeScript core, the companion app, the
Android keyboard, and an unsigned iOS simulator build. OpenFlow Mobile is **not yet on the App
Store or Play Store**, and it hasn't been tested on a real device yet — the native pieces (Swift
keyboard extension, Kotlin IME) are built and unit-tested in CI but unverified on hardware. If
you're willing to sideload a debug build and tell us what breaks, see
[`docs/TESTING.md`](docs/TESTING.md) — we're looking for testers.

## Install

There's no store listing yet, so for now:

- **Android:** grab the `openflow-android-debug` artifact from the latest green run of the
  [Android CI workflow](.github/workflows/android.yml) (GitHub Actions → Actions tab → a recent
  `Android` run → Artifacts). It's a debug APK you can install directly on a device with
  "install unknown apps" enabled — no Play Store needed. Details in
  [`docs/TESTING.md`](docs/TESTING.md).
- **iOS:** the `openflow-ios-simulator` artifact from the [iOS CI workflow](.github/workflows/ios.yml)
  is an **unsigned Simulator build** — useful for developers running the iOS Simulator, not
  installable on a physical device. Running on a real iPhone today means building from source
  with Xcode (see [`docs/TESTING.md`](docs/TESTING.md)); TestFlight will follow once the maintainer
  has an Apple Developer account (tracked in [`docs/STORE-SUBMISSION.md`](docs/STORE-SUBMISSION.md)).
- **Store releases** (TestFlight → App Store, and Play Console) come after the maintainer adds
  paid developer accounts — see [`docs/STORE-SUBMISSION.md`](docs/STORE-SUBMISSION.md) for the
  full runbook.

## Development

```bash
npm install
npm test          # shared/ (jest, node) + app/ (jest-expo)
npm run typecheck
npm run lint
```

You do **not** need Xcode or the Android SDK installed locally to work on the TypeScript app or the
shared core — `shared/` is plain Node/Jest, and `app/` runs under `jest-expo` without a native
build. The native directories (`ios/`, `android/`) are generated by `npx expo prebuild` and are not
committed; native source lives in `targets/` (Swift, for the iOS keyboard) and `android-ime/`
(Kotlin, for the Android IME), wired in by Expo config plugins in `plugins/`. GitHub Actions
compiles both native targets on every push — see `.github/workflows/{ci,android,ios}.yml` — so you
can validate a native change without owning a Mac or an Android SDK setup.

If you do want to run a native build locally:

```bash
npx expo prebuild -p ios       # generates ios/ (needs a Mac + Xcode)
npx expo prebuild -p android   # generates android/ (needs the Android SDK)
```

## Contributions

> **Contributions are not being accepted right now.** OpenFlow Mobile is a solo project maintained
> alongside a full-time job and [knotie.ai](https://knotie.ai). There isn't bandwidth to review and
> maintain incoming PRs at the moment.
>
> If you'd like to request a feature or report a bug, please
> **[open an issue](https://github.com/avijeett007/openflow-mobile/issues)** — features keep getting
> added over time, just without a fast turnaround guarantee. Forks are welcome. You can also reach
> out at **[hello@openflow.computer](mailto:hello@openflow.computer)**.

## Support

If OpenFlow saves you time, consider supporting its development:

- [Buy Me a Coffee](https://buymeacoffee.com/kno2gether)

## License

MIT — see [LICENSE](LICENSE).

---

<p><sub>Built by the team behind <a href="https://knotie.ai"><strong>knotie.ai</strong></a> — where you can white-label and sell AI services.</sub></p>
