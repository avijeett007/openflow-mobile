# Store submission runbook

This is a step-by-step guide for the maintainer to ship OpenFlow Mobile to the App Store and
Play Store once the accounts exist. Nothing here has been executed yet — no Apple or Google
developer account exists at the time of writing (see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md),
"Store-readiness pre-baked"). CI currently produces only unsigned builds
(`.github/workflows/ios.yml`, `.github/workflows/android.yml`).

Identifiers (final, do not change — see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)):

- iOS bundle id: `computer.openflow.mobile`; keyboard extension: `computer.openflow.mobile.keyboard`
- Android `applicationId`/package: `computer.openflow.mobile`
- App Group: `group.computer.openflow.mobile`
- URL scheme: `openflow://` (route `dictate`)

---

## Apple App Store

### 1. Join the Apple Developer Program

- [developer.apple.com/programs](https://developer.apple.com/programs/) — $99/yr, individual or
  organization account.

### 2. Register identifiers in the developer portal

In **Certificates, Identifiers & Profiles**:

1. Create an **App ID**: `computer.openflow.mobile`, enable the **App Groups** capability.
2. Create a second **App ID** for the keyboard extension: `computer.openflow.mobile.keyboard`,
   also with **App Groups** enabled.
3. Create the **App Group**: `group.computer.openflow.mobile`, and attach both App IDs to it.
4. Note the **Team ID** (10-character string, visible in the Membership page).

### 3. Wire the Team ID into the build

- Set `APPLE_TEAM_ID` locally (`.env`, or exported in your shell) before running a signed build —
  `app.config.ts` already reads `process.env.APPLE_TEAM_ID` for `ios.appleTeamId` and
  `@bacons/apple-targets` mirrors it into the keyboard target.
- Add `APPLE_TEAM_ID` as a **GitHub Actions repository secret** — `.github/workflows/ios.yml`
  already passes it through as an env var; today it's empty and the workflow only produces an
  unsigned simulator build. Once the secret is set, signed builds become possible from CI (with
  additional signing-credential secrets — see EAS quickstart below, which is the easier path).

### 4. Build a signed archive

Two options:

**Option A — EAS (recommended, less manual credential juggling):**

```bash
npm i -g eas-cli
eas login
eas build:configure          # generates eas.json if not present
eas build -p ios --profile production
```

EAS can generate and store the signing certificate/provisioning profile for you (`eas credentials`),
which avoids hand-managing `.p12`/`.mobileprovision` files. Requires the Apple Developer account
from step 1 to be linked (`eas device:create` for ad-hoc/TestFlight-internal testing devices, if
needed).

**Option B — manual `xcodebuild` archive** (no EAS, full local control):

```bash
npx expo prebuild -p ios
cd ios && pod install
xcodebuild -workspace OpenFlow.xcworkspace -scheme OpenFlow \
  -configuration Release -sdk iphoneos \
  -archivePath build/OpenFlow.xcarchive \
  DEVELOPMENT_TEAM=<APPLE_TEAM_ID> \
  archive
xcodebuild -exportArchive -archivePath build/OpenFlow.xcarchive \
  -exportPath build/export -exportOptionsPlist ExportOptions.plist
```

You'll need an `ExportOptions.plist` (method `app-store`) and a valid distribution certificate +
provisioning profiles for both the app and keyboard extension targets, either created manually in
Xcode ("Automatically manage signing" with the team selected) or via `fastlane match`/`sigh`.

### 5. Upload to TestFlight

- `xcrun altool --upload-app` or Xcode Organizer (manual path), or `eas submit -p ios` (EAS path).
- Add internal testers in App Store Connect → TestFlight; external testing requires a first
  "Export Compliance" answer (OpenFlow makes standard HTTPS calls to user-configured endpoints —
  no custom cryptography, so the standard "uses only exempt encryption" answer applies) and a
  beta app review pass before external testers can install.

### 6. App Review notes — specific to keyboard extensions

Custom keyboards get extra Apple scrutiny. Draft reviewer notes to include in App Store Connect:

> OpenFlow includes a custom keyboard extension. The keyboard **requests Full Access**
> (`RequestsOpenAccess = YES`) because it needs App Group storage to receive dictation results
> from the companion app and network access is technically available to Full-Access keyboards —
> however, **the keyboard extension itself never makes a network call**. All audio recording,
> speech-to-text, and AI cleanup happen in the container app, not the extension (iOS keyboard
> extensions cannot access the microphone at all — this is a platform restriction, not a design
> choice). Audio is sent only to the STT/LLM endpoint the _user_ has configured in the app's
> Settings screen, using an API key the user supplies. OpenFlow's own servers never see this
> audio or its transcript — there are no OpenFlow-operated servers in this data path.
>
> **The keyboard is fully functional without Full Access** — the QWERTY layer, symbols pages, and
> text entry all work with only basic access. Without Full Access, the mic button shows a short
> "Enable Full Access for dictation" hint instead of attempting to dictate, since dictation
> requires reading the App Group hand-off that Full Access unlocks.
>
> A privacy policy is published at `https://openflow.computer/mobile-privacy` (see
> `docs/PRIVACY-POLICY.md` in this repo for the source).

Checklist before submitting:

- [ ] Privacy policy URL is live and reachable (`https://openflow.computer/mobile-privacy`).
- [ ] Keyboard works with Full Access **off** (test explicitly — this is a common rejection reason).
- [ ] `NSMicrophoneUsageDescription` (container app only, managed by the `expo-audio` config
      plugin) has a clear, honest description.
- [ ] App Store screenshots show the actual dictation flow, including the iOS hop (don't imply
      in-keyboard recording — reviewers who use other dictation keyboards will notice the pattern
      and reject copy that overclaims).
- [ ] `PrivacyInfo.xcprivacy` in `targets/keyboard/` (see [`targets/keyboard/README.md`](../targets/keyboard/README.md))
      declares the required-reason API usage (`UserDefaults`, reason `CA92.1`).

---

## Google Play

### 1. Create a Play Console account

- [play.google.com/console](https://play.google.com/console/) — **$25 one-time** registration fee.

### 2. Create the app

- Play Console → **Create app** → package name `computer.openflow.mobile` (must match
  `android.package` in `app.config.ts` exactly, and cannot be changed after first upload).

### 3. Generate an upload keystore

If you don't already have one:

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore openflow-upload-key.keystore \
  -alias openflow-upload -keyalg RSA -keysize 2048 -validity 10000
```

Keep this file and its passwords **out of git** (see `.gitignore`) and back it up somewhere
durable — losing it means you can no longer publish updates to an existing Play listing.

### 4. Build a signed AAB

**Option A — EAS:**

```bash
eas build -p android --profile production
```

EAS can hold the upload keystore for you (`eas credentials`) or you can upload the one generated
in step 3.

**Option B — manual Gradle:**

```bash
npx expo prebuild -p android
cd android
./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file=/path/to/openflow-upload-key.keystore \
  -Pandroid.injected.signing.store.password=<password> \
  -Pandroid.injected.signing.key.alias=openflow-upload \
  -Pandroid.injected.signing.key.password=<password>
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`. (Prefer wiring the signing
config into `android/gradle.properties` / a local `keystore.properties` file over passing
passwords on the command line, once you've settled on the manual path.)

### 5. Data Safety form — draft answers

Play Console → App content → Data safety. These answers should match OpenFlow's actual behavior;
update this draft if the data flow ever changes.

| Question                                                            | Answer                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does your app collect or share any of the required user data types? | **Yes** — audio (voice) is collected, but only ephemerally and only sent to endpoints the user configures.                                                                                                                                                               |
| Audio data collected?                                               | **Yes.** Voice recordings, collected only while the user actively dictates (tap-to-talk, no background listening).                                                                                                                                                       |
| Is this data processed ephemerally?                                 | **Yes.** OpenFlow does not store or transmit audio to any OpenFlow-operated server. Audio is sent directly from the user's device to the third-party STT endpoint the user configured (e.g. Groq, OpenAI, Deepgram, or a self-hosted URL), using the user's own API key. |
| Is data shared with third parties?                                  | **Yes, but only third parties the user explicitly configures** (their chosen STT/cleanup provider) — not shared by OpenFlow with anyone else.                                                                                                                            |
| Is data collected for advertising or marketing?                     | **No.**                                                                                                                                                                                                                                                                  |
| Does the app contain ads?                                           | **No.**                                                                                                                                                                                                                                                                  |
| Is user data encrypted in transit?                                  | **Yes** — HTTPS to the configured endpoint (Ollama over plain HTTP to `localhost` is the one user-opted-in exception, since it never leaves the device).                                                                                                                 |
| Can users request data deletion?                                    | Not applicable in the traditional sense — OpenFlow doesn't hold user data on a server. Locally, users can clear history from within the app at any time.                                                                                                                 |
| Where is history/transcript data stored?                            | **On-device only** (local app storage). Never uploaded to OpenFlow.                                                                                                                                                                                                      |

### 6. Submit for review

- Complete the Play Console checklist: content rating questionnaire, target audience, privacy
  policy URL (`https://openflow.computer/mobile-privacy`), app access instructions (note that a
  Groq/OpenAI/etc. API key is required to fully exercise dictation — provide a free-tier test key
  or clear instructions in the "app access" notes for the reviewer).
- Start on a **closed testing track** before promoting to production, per Play's standard rollout
  guidance for new apps with sensitive permissions (`RECORD_AUDIO`).

---

## EAS quickstart (optional)

EAS Build/Submit is optional — CI already produces unsigned artifacts without it, and the manual
`xcodebuild`/`gradlew` paths above work without any Expo account. Use EAS if you'd rather not
manage signing credentials by hand.

```bash
npm i -g eas-cli
eas login
eas init                 # links this repo to an Expo project
eas build:configure      # generates eas.json
eas build -p ios --profile production      # after APPLE_TEAM_ID / credentials are set up
eas build -p android --profile production  # after the upload keystore is set up
eas submit -p ios        # optional: pushes the build straight to TestFlight
eas submit -p android    # optional: pushes the AAB straight to Play Console
```
