# C4 — Android IME + config plugin + settings bridge (build notes)

Scope of chunk C4: the Android voice keyboard (`android-ime/`), its Expo config
plugin (`plugins/withAndroidIme.js`), the `settings-bridge` local Expo module
(`modules/settings-bridge/`, Android side + iOS no-op stub), and the Android CI
workflow (`.github/workflows/android.yml`). `shared/` is read-only; `app/`,
`targets/`, `app.config.ts` are owned by other chunks and were NOT modified.

---

## Storage contract (THE cross-agent interface — the app's settings-bridge MUST match)

The IME service runs in the **same app package/UID** as the companion app, so
there is no App Group / cross-app storage on Android — the app writes, the
keyboard reads the same files directly.

| What                | Store type                         | File name           | Key                                                             | Value                                         |
| ------------------- | ---------------------------------- | ------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| Non-secret settings | `SharedPreferences` (MODE_PRIVATE) | `openflow.settings` | `settings.json`                                                 | serialized `@openflow/shared` `Settings` JSON |
| API keys            | `EncryptedSharedPreferences`       | `openflow.secrets`  | the setting's `apiKeyRef` (e.g. `stt.apiKey`, `cleanup.apiKey`) | raw secret string                             |

- Writer: `modules/settings-bridge/android/.../SettingsBridgeModule.kt`
  (`syncSettings(json)`, `syncSecret(ref, value)`).
- Reader: `android-ime/.../SettingsBridgeStore.kt` (`getSettingsJson()`,
  `getSecret(ref)`).
- Both hard-code the same three constants (`SETTINGS_PREFS`, `SETTINGS_KEY`,
  `SECRETS_PREFS`). They live in two different gradle modules (the app module vs
  the autolinked `settings-bridge` library) so they cannot share a symbol —
  **if you change one, change the other.**
- `EncryptedSharedPreferences` uses `MasterKey` `AES256_GCM`, key scheme
  `AES256_SIV` (keys) + value scheme `AES256_GCM` — identical on both sides
  (required, or the reader cannot decrypt).
- The settings JSON is exactly what `serializeSettings()`/`parseSettings()` in
  `@openflow/shared` produce. `apiKeyRef` values in it name secrets stored in
  `openflow.secrets`; the JSON itself never contains a key (shared's security
  invariant).

### App-side usage (for the C2 app agent)

```ts
import { syncSettings, syncSecret } from '../modules/settings-bridge';
syncSettings(JSON.stringify(serializeSettings(settings)));
syncSecret('stt.apiKey', theKey); // whenever a key changes
syncSecret('cleanup.apiKey', theKey);
```

### Deep link the keyboard fires (for the C2 app agent)

When the mic is tapped without `RECORD_AUDIO` granted (an IME has no Activity and
cannot request runtime permissions), the keyboard launches the app's launcher
intent with `FLAG_ACTIVITY_NEW_TASK` and an extra:

- extra key `openflow.route`, values: `"mic-permission"` (came to request mic)
  or `"settings"` (the "OpenFlow" shortcut key).

The app should read this extra on launch and route to a screen that requests
`RECORD_AUDIO` (mic-permission) or opens settings. This is a soft contract — if
the app ignores it, the app still just opens.

---

## Dependency choice: HttpURLConnection over OkHttp (zero deps)

`OpenFlowHttp.kt` uses `java.net.HttpURLConnection`, not OkHttp. The HTTP surface
is tiny (3 request shapes) and multipart here is trivial — a single file part
plus two text fields with a fixed boundary. That does not justify pulling in
OkHttp. Keeping it dependency-free also keeps the whole file **pure JVM** (no
`android.*`, no third-party jars), which is what makes it unit-testable by
`testDebugUnitTest` without Robolectric or a device.

The only added Android dependency is `androidx.security:security-crypto`
(`1.1.0-alpha06`, for `EncryptedSharedPreferences` + the `MasterKey.Builder`
API — the `1.0.0` `MasterKeys` API is deprecated). Injected into the app module
by the plugin, and declared directly in the `settings-bridge` module's
`build.gradle`.

For unit tests the plugin adds `junit:junit:4.13.2` and a **real**
`org.json:json:20240303` as `testImplementation`. On device the platform
`org.json` is used; in JVM unit tests the Android Gradle plugin places the
(stubbed) `android.jar` last on the classpath, so the real `org.json` wins — the
standard way to run `org.json` code in Android unit tests.

---

## The Kotlin HTTP mirror ↔ shared/fixtures contract

`OpenFlowHttp` mirrors `shared/src/stt` + `shared/src/cleanup` exactly:

- **OpenAI-compatible STT** (`groq`/`openai`/`custom`): `POST <base>/audio/transcriptions`,
  `Authorization: Bearer <key>`, multipart fields in order `file, model,
response_format` (`response_format=json`), response `{ text }`.
- **Deepgram STT**: `POST <base>/v1/listen?model=<model>&smart_format=true`,
  `Authorization: Token <key>`, `Content-Type: <mime>`, raw-audio body, response
  `results.channels[0].alternatives[0].transcript`.
- **Cleanup** (`groq`/`openai`/`openrouter`/`ollama`/`custom`): `POST
  <base>/chat/completions`, `Content-Type: application/json`, `Authorization:
  Bearer <key>` **omitted when the key is empty** (Ollama), body `{ model,
  messages:[{system,prompt},{user,transcript}], temperature:0.2, stream:false }`,
  response `choices[0].message.content` (trimmed).
- Base-URL resolution (default maps, `custom` requires `baseUrl`, trailing-slash
  strip) matches shared line-for-line.

`OpenFlowHttpContractTest` loads the **same** `shared/fixtures/*.json` (mirrored
into the app module's `src/test/resources/fixtures/` by the plugin) and asserts
URL, method, headers, multipart field order / raw body, cleanup body shape, and
response parsing — the Kotlin analogue of `shared/src/fixtures.test.ts`. Design
mirrors the TS `fetchImpl` injection: request-building and response-parsing are
pure functions, and `transcribe`/`cleanTranscript` run them through an injectable
`HttpTransport` (`DefaultHttpTransport` = real `HttpURLConnection`).

Audio is sent as `audio/wav` / `audio.wav` (the IME records 16 kHz mono PCM and
WAV-wraps it). The shared contract is mime-agnostic, so WAV works for both the
multipart and Deepgram paths.

---

## The config plugin (`withAndroidIme.js`)

Split into three focused mods (per Expo guidance: file writes only in dangerous
mods; idempotent tagged gradle edits, not raw regex):

1. `withAndroidManifest` — adds `RECORD_AUDIO` + `INTERNET` (guarded against the
   template's existing `INTERNET` so no duplicate tag) and the IME `<service
android:name="computer.openflow.mobile.ime.OpenFlowIme"
android:permission="android.permission.BIND_INPUT_METHOD" android:exported="true">`
   with the `android.view.InputMethod` intent-filter and `android.view.im`
   meta-data → `@xml/method`.
2. `withDangerousMod('android')` — copies `android-ime/src/main/java` and
   `android-ime/src/test/java` into the app module, mirrors `shared/fixtures/*.json`
   into `app/src/test/resources/fixtures`, and writes `res/xml/method.xml`
   (keyboard IME subtype) + `res/values/openflow_ime.xml` (namespaced strings, to
   avoid colliding with app-owned resources).
3. `withAppBuildGradle` — injects the three gradle deps via the idempotent,
   tagged `mergeContents` helper anchored on `dependencies {`.

Kotlin sources are authored under `android-ime/` (git-tracked) and copied into
the **git-ignored** generated `android/` at prebuild — the CNG model. The plugin
is already registered in `app.config.ts` as `./plugins/withAndroidIme` (wired in
C1); no config change was needed.

---

## Prebuild inspection evidence (local, no Android SDK)

`npx expo prebuild -p android --no-install --clean` succeeds. In the generated
(git-ignored) `android/`:

- `app/src/main/AndroidManifest.xml`: `INTERNET` ×1, `RECORD_AUDIO` ×1, and the
  `<service>` with the `android.view.InputMethod` intent-filter + `android.view.im`
  meta-data → `@xml/method`.
- `app/src/main/res/xml/method.xml` + `app/src/main/res/values/openflow_ime.xml`
  present.
- `app/src/main/java/computer/openflow/mobile/ime/`: `OpenFlowHttp.kt`,
  `OpenFlowIme.kt`, `SettingsBridgeStore.kt`, `WavRecorder.kt`.
- `app/src/test/java/.../OpenFlowHttpContractTest.kt` + all six fixtures under
  `app/src/test/resources/fixtures/`.
- `app/build.gradle`: single tagged `openflow-ime-deps` block with
  `security-crypto` + `junit` + `org.json`.
- `expo-modules-autolinking search -p android` lists `settings-bridge` →
  `expo.modules.settingsbridge.SettingsBridgeModule`.

`npx expo config --type public` parses; `typecheck` / `lint` / shared `test`
(44 tests incl. the fixture contract) are green. The Kotlin build +
`testDebugUnitTest` run in `android.yml` on CI (no local Android SDK here).

---

## Judgment calls

- **Programmatic keyboard UI** (no layout XML): the input view is built in
  `OpenFlowIme.buildKeyboardView()` to avoid depending on app-owned resources and
  to keep all keyboard copy/colours in one Kotlin file (violet `#7C5CFF` accent,
  dark surface). Cost: no XML preview; benefit: zero resource coupling.
- **Namespaced res** (`openflow_ime_*` in a dedicated values file): prevents any
  collision with strings the C2 app defines.
- **`security-crypto:1.1.0-alpha06`** (not stable `1.0.0`): the stable line's
  `MasterKeys` API is deprecated; `1.1.0-alpha06` is the widely used version with
  `MasterKey.Builder`. Revisit if a stable `1.1.x` ships.
- **Cleanup is best-effort**: if STT succeeds but cleanup fails, the raw
  transcript is held and offered via an "Insert raw transcript" button rather
  than dropped (mirrors the shared "caller owns fallback" policy).
- **`switchToPreviousInputMethod()`** used on API 28+, falling back to the system
  input-method picker below that, so the switch-keyboard key always works.
- **Duplicate-permission guard**: `AndroidConfig.Permissions.addPermission` does
  not dedupe against the base template, so the plugin checks first (found and
  fixed during prebuild inspection — the template already ships `INTERNET`).
- **Two copies of the storage constants** (module vs IME) are intentional: they
  are in separate gradle modules and documented as a lock-step contract above.
