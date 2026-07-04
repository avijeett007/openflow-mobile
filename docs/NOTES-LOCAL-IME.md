# Local (on-device) STT — Android IME (build notes)

Adds a **local (on-device)** speech-to-text mode to the Android voice keyboard.
When the persisted settings JSON has `stt.mode == "local"`, the IME transcribes
with Android's `SpeechRecognizer` (no WAV recording, no HTTP, **no API key**).
Remote / self-hosted paths are byte-for-byte unchanged.

Scope of this change: `android-ime/` (new `LocalSttEngine.kt`,
`LocalSttLogic.kt`, `LocalSttLogicTest.kt`; edits to `OpenFlowIme.kt`) and one
minimal, idempotent addition to `plugins/withAndroidIme.js` (a `<queries>` entry).
`shared/`, `src/`, `app.config.ts`, `targets/`, `modules/`, `.github/` were **not**
touched.

---

## The ONLY new cross-agent contract

`stt.mode` in the settings JSON the IME already reads (written by the app's
`settings-bridge`, per `docs/NOTES-C4.md`). The IME treats it as an opaque
string:

- `"local"` (exact, case-sensitive) → on-device path.
- **anything else** — `"remote"`, `"selfHosted"`, an unknown/future value, a
  missing `mode`, a missing `stt` object, or null/blank/malformed JSON → the
  existing remote path. Nothing regresses if the app hasn't shipped the field yet.

The decision lives in one pure function, `LocalSttLogic.decideSttPath(json)`,
unit-tested for every one of those cases. The parallel agent adds `"local"` to
the zod schema + app UI; no other coordination is required.

---

## Behavior matrix

| `stt.mode`            | Path   | Mic tap 1        | Live UI                    | Mic tap 2      | API key needed?           |
| --------------------- | ------ | ---------------- | -------------------------- | -------------- | ------------------------- |
| `"local"`             | LOCAL  | start listening  | partial text in status row | finish early   | **No** (STT). Cleanup: only if enabled + key |
| `"remote"`            | REMOTE | start recording  | "Listening… tap to stop"   | stop → HTTP    | Yes (STT), as before      |
| `"selfHosted"`        | REMOTE | (same as remote) | (same)                     | (same)         | Yes (STT), as before      |
| unknown / missing     | REMOTE | (same as remote) | (same)                     | (same)         | Yes (STT), as before      |

### Local final-result handling

1. Empty result → status "Didn't catch that" (from the `ERROR_NO_MATCH` map),
   nothing committed.
2. Non-empty → **cleanup gate** `LocalSttLogic.shouldRunCleanup(enabled, hasKey)`:
   - Cleanup runs only when it is **enabled AND a cleanup key is present** (or the
     cleanup provider is keyless, e.g. Ollama). Runs on the background executor via
     the existing `OpenFlowHttp.cleanTranscript`; on failure the raw transcript is
     held and offered via the existing "Insert raw transcript" button (same
     best-effort policy as the remote path).
   - Otherwise the raw on-device transcript is committed directly. So local mode
     with no keys at all still fully works (dictate → commit), never erroring on a
     missing STT key or a missing cleanup key.
3. Commit is `currentInputConnection.commitText(text, 1)`, identical to today.

Partials are shown in the status area only — **never committed** (they change).

---

## On-device strictness & availability caveats (by API level / device)

`LocalSttEngine.availability(context)` returns one of three states; the IME uses
it to pick the recognizer and to tell the user when the feature isn't usable.

| State              | When                                                                 | Recognizer built                                   | Guarantee                                                  |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `ON_DEVICE`        | API **31+** and `isOnDeviceRecognitionAvailable(context)` true       | `createOnDeviceSpeechRecognizer(context)`          | **Strict** — audio stays on device                         |
| `NETWORK_FALLBACK` | otherwise, if `isRecognitionAvailable(context)` true                 | `createSpeechRecognizer(context)` + `EXTRA_PREFER_OFFLINE=true` | **Best-effort offline** (see caveat)          |
| `UNAVAILABLE`      | no recognition service installed                                     | none — `onError(ERROR_ENGINE_UNAVAILABLE)`         | UI: "On-device recognition unavailable on this phone"      |

Caveats:

- **Pre-31 `EXTRA_PREFER_OFFLINE` is best-effort.** The flag (added API 23) only
  *asks* the engine to stay offline; there is no API to verify it and some OEM
  engines ignore it and use the network. Documented in `LocalSttEngine`'s KDoc.
  If strict on-device is a hard requirement, gate the "Local" option in the app to
  API 31+ where `ON_DEVICE` is real.
- **`isOnDeviceRecognitionAvailable` may be conservative / async on some API 33+
  devices.** A false negative degrades gracefully to `NETWORK_FALLBACK` (never a
  crash). The on-device language model often needs a one-time download via system
  settings; before that, `ERROR_LANGUAGE_UNAVAILABLE` → "Language pack unavailable
  — install it in system settings".
- **Android 11+ package visibility:** `isRecognitionAvailable` returns false
  without a `<queries>` declaration for `android.speech.RecognitionService`. Added
  by the plugin (below). Without it, local mode would report UNAVAILABLE on every
  API 30+ device even when an engine exists.
- **Language:** taken from the device's primary locale
  (`configuration.locales.get(0)`, `.locale` pre-24) as an IETF tag via
  `EXTRA_LANGUAGE`.

---

## Lifecycle / threading

`SpeechRecognizer` must be created, used, and destroyed on the **main thread**.
The IME drives `start`/`stop`/`cancel` from main-thread UI callbacks, and the
recognizer delivers `RecognitionListener` callbacks on the main thread, so status
updates and `commitText` are main-thread safe (cleanup's network call is the only
thing pushed to the executor). The engine is torn down (`cancel()` →
`recognizer.destroy()`) in `onFinishInputView` (IME hidden) and `onDestroy`, and
before every `start`, so it never leaks. `stop()` (second tap) requests an early
finish and still yields a final result.

---

## Manifest change (plugin)

`plugins/withAndroidIme.js` `withImeManifest` now also adds, idempotently:

```xml
<queries>
  <intent><action android:name="android.speech.RecognitionService"/></intent>
</queries>
```

`RECORD_AUDIO` was already present (added for the remote recorder) and is reused.
No new permission is required for local STT. The addition is guarded by a
presence check so re-runs don't duplicate it. It emerges in the generated
manifest as a second top-level `<queries>` element (alongside the deep-link one);
the Android manifest merger treats multiple `<queries>` additively, so both apply.

---

## Tests (JVM, `testDebugUnitTest`)

`SpeechRecognizer` isn't JVM-testable, so the pure logic is extracted into
`LocalSttLogic` and tested in `LocalSttLogicTest` (added to the same test source
set the plugin copies, so it runs in `android.yml`):

- `decideSttPath`: local → LOCAL; remote/selfHosted/unknown/missing-mode/
  missing-stt/null/blank/malformed → REMOTE; case-sensitivity of `"local"`.
- `localModeNeedsSttKey()` == false (local needs no key).
- `shouldRunCleanup`: the full enabled × hasKey truth table.
- `errorMessage`: known code mappings (incl. `ERROR_NO_MATCH` = "Didn't catch
  that", `ERROR_INSUFFICIENT_PERMISSIONS`, `ERROR_LANGUAGE_UNAVAILABLE`, engine-
  unavailable), the error-code constants equal the platform `SpeechRecognizer`
  ints, and unknown code surfaces the raw number.

The existing `OpenFlowHttpContractTest` is untouched and stays green.

---

## Verification performed (no Android SDK locally)

- `npx expo prebuild -p android --no-install --clean` succeeds. Generated
  `android/app/src/main/AndroidManifest.xml` contains the
  `android.speech.RecognitionService` `<queries>` element, `RECORD_AUDIO`, and the
  intact `OpenFlowIme` `<service>` (InputMethod filter + `android.view.im` →
  `@xml/method`). `LocalSttEngine.kt` + `LocalSttLogic.kt` copied into
  `app/src/main/java/.../ime/`; `LocalSttLogicTest.kt` +
  `OpenFlowHttpContractTest.kt` into `app/src/test/java/.../ime/`.
- `npm run typecheck`, `npm run lint` (covers the plugin JS), `npm test` (25 TS
  tests) all green — no TS/JS regressions.
- Pure Kotlin logic compiled with standalone `kotlinc` 1.9.24 and
  `LocalSttLogicTest` run on the JVM off-repo: **12/12 pass**. (The android.*
  files — `LocalSttEngine`, `OpenFlowIme` — are compiled by CI `android.yml`;
  they use `SpeechRecognizer` APIs guarded by `Build.VERSION.SDK_INT` checks so
  they build against compileSdk 35 and run from minSdk.)

---

## Judgment calls (for the orchestrator)

- **On-device strictness fallback.** Rather than refusing to work below API 31, we
  fall back to the standard recognizer with `EXTRA_PREFER_OFFLINE=true` and surface
  the `NETWORK_FALLBACK` state. This maximizes device coverage; the trade-off is
  that "on-device" is only *guaranteed* on API 31+. If the product needs a hard
  privacy guarantee, gate the app's "Local" toggle to API 31+ (the engine already
  distinguishes the states, so the app can query it).
- **Cleanup key gate includes keyless providers.** The literal spec is "enabled AND
  cleanup key present"; the pure `shouldRunCleanup(enabled, hasKey)` implements
  exactly that. In the IME, `hasKey` is `secret non-empty OR provider == "ollama"`
  so a keyless local Ollama cleanup still runs. If that's unwanted, drop the
  `|| provider == "ollama"` clause in `OpenFlowIme.onLocalFinal`.
- **Error-code constants re-declared** in `LocalSttLogic` (mirroring
  `SpeechRecognizer.ERROR_*`) instead of referencing the android class, so the
  mapping stays pure-JVM and testable. A test pins the int values to the platform
  constants (1/7/9/13) to catch any drift.
- **Second `<queries>` element** (not merged into the existing deep-link one):
  simplest idempotent injection and semantically identical after manifest merge.
- **No new UI surface** in the keyboard for local mode: the existing status row
  shows partials/errors and the existing mic button toggles start/finish, keeping
  the keyboard's single-Kotlin-file, no-XML design intact.
