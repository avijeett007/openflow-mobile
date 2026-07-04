# Testing on a real device (today, pre-store)

OpenFlow Mobile has not been tested on physical hardware yet — CI (`.github/workflows/ci.yml`,
`android.yml`, `ios.yml`) only proves that the code typechecks, lints, passes unit tests, and
compiles into an Android debug APK / an unsigned iOS Simulator build. This doc is for anyone
willing to sideload a build and report back what actually happens on a phone.

## Android

Android is the flagship experience (the keyboard records in-line, no app hop), so this is the
easiest and most useful path to test today.

1. **Get the APK:**
   - Go to the repo's **Actions** tab → the latest green **Android** workflow run on `main` →
     scroll to **Artifacts** → download `openflow-android-debug` (a zip containing
     `app-debug.apk`).
2. **Install it:**
   - Copy the APK to your phone (email, cloud drive, `adb push`, whatever's convenient).
   - If installing via Files/browser: Android will prompt to allow installs from that source
     ("install unknown apps") the first time — allow it, then tap the APK to install.
   - Or, with a phone connected over USB with Developer Options → USB debugging enabled:
     ```bash
     adb install path/to/app-debug.apk
     ```
3. **Enable the keyboard:**
   - Settings → System → Languages & input → On-screen keyboard → Manage keyboards → enable
     **OpenFlow**.
   - Switch to it from any text field (globe/keyboard-switch key, or the system keyboard picker).
4. **Grant microphone permission:**
   - The IME itself can't prompt for runtime permissions (no Activity), so tapping the mic before
     granting `RECORD_AUDIO` launches the OpenFlow app to request it — follow that prompt once.
5. **Configure a provider:**
   - Open the OpenFlow app → Settings → set STT provider to **Groq** (fastest to get a free key
     from [console.groq.com](https://console.groq.com)) and paste in an API key. Cleanup is
     optional — leave it off to test raw transcription first.
6. **Dictate:**
   - Open any app with a text field (Notes, Messages, a browser search box), switch to the
     OpenFlow keyboard, tap the mic, speak, tap again to stop (or however the current build's
     press-and-hold/tap-toggle is wired — check the keyboard's visible state chip). Text should
     be inserted directly.

## iOS

There's no TestFlight build yet (see [`docs/STORE-SUBMISSION.md`](STORE-SUBMISSION.md)), so
testing on a real iPhone today means building from source.

### Option A — build to your own device with a free Apple ID

1. Clone this repo on a Mac with Xcode installed, run `npm install`.
2. `npx expo prebuild -p ios` to generate the `ios/` project, then `cd ios && pod install`.
3. Open `ios/OpenFlow.xcworkspace` in Xcode.
4. Connect your iPhone via USB (or Wi-Fi debugging), select it as the run destination.
5. Select the `OpenFlow` scheme → Signing & Capabilities → sign in with your Apple ID (a free
   account works for on-device testing, no paid Developer Program membership required) and let
   Xcode auto-manage a personal-team signing certificate for **both** the `OpenFlow` app target
   and the `keyboard` extension target (App Groups requires the App Group capability to resolve
   for both — Xcode will offer to register a personal-team App Group automatically).
6. Build and run (⌘R). Trust the developer certificate on the device the first time
   (Settings → General → VPN & Device Management).
7. Enable the keyboard: Settings → General → Keyboard → Keyboards → Add New Keyboard → OpenFlow,
   then enable **Allow Full Access** (required — dictation results are handed off through an App
   Group, which needs Full Access to read).
8. Configure a provider in the OpenFlow app (same as Android, step 5 above).
9. Switch to the OpenFlow keyboard in any text field, tap the mic — this hops you to the OpenFlow
   app (this is expected; iOS keyboards cannot record audio, see
   [`README.md`](../README.md#what-it-is)). Speak, wait for the status to reach "ready", then
   switch back to the original app via the system "‹ Back" banner/breadcrumb — the keyboard
   should insert the cleaned-up text automatically.

A free Apple ID's personal-team provisioning profiles expire after about 7 days, so you'll need
to re-build periodically for ongoing testing.

### Option B — Simulator (for developers, not real-device testing)

The `openflow-ios-simulator` artifact from the [iOS CI workflow](../.github/workflows/ios.yml) is
a ready-built `.app` for the Simulator. Useful for verifying the keyboard's UI and the basic
QWERTY layer, but the Simulator **cannot** exercise the microphone/dictation flow the same way
hardware can (host-mic passthrough behaves differently) and isn't a substitute for the on-device
test above.

```bash
unzip openflow-ios-simulator.zip
xcrun simctl install booted OpenFlow.app
xcrun simctl launch booted computer.openflow.mobile
```

Then add the keyboard from the Simulator's Settings app the same way as on a real device.

### Option C — wait for TestFlight

Once the maintainer has an Apple Developer Program account and a signed build in TestFlight (see
[`docs/STORE-SUBMISSION.md`](STORE-SUBMISSION.md)), this will be the easiest path. Not available
yet.

## What to report back

Whichever platform you test on, please open a GitHub issue at
**[github.com/avijeett007/openflow-mobile/issues](https://github.com/avijeett007/openflow-mobile/issues)**
with:

- Device model + OS version.
- Which STT/cleanup provider you used.
- What you expected vs. what happened (crash, wrong text, insertion into the wrong field, mic
  permission issues, keyboard not appearing in the picker, etc.).
- For iOS: whether the app-hop and "‹ Back" return worked smoothly, since that flow is the least
  proven part of the build.
- Logs/screenshots if you have them.
