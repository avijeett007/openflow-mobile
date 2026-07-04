# Chunk C3 — iOS keyboard extension + Expo wiring (build notes)

Scope delivered: the `computer.openflow.mobile.keyboard` custom keyboard
extension (Swift), its `@bacons/apple-targets` wiring, App Group entitlements on
both app + extension, prebuild validation, and `ios.yml` CI.

## App Group + hand-off contract (authoritative for the C2 app agent)

- **App Group / UserDefaults suite:** `group.computer.openflow.mobile`
- **Keys:**
  - `openflow.handoff.latest` — latest payload, overwritten as the flow progresses.
  - `openflow.handoff.<rid>` — per-request, authoritative when present.
- **Value:** the canonical **JSON string** from `@openflow/shared` `encodeHandoff()`.
  The app must store a **string** (not a plist dict) so the Swift side can
  `JSONDecoder().decode(DictationHandoff.self)`.
- **Payload fields (mirrored EXACTLY from `shared/src/handoff`):**
  `{ rid: string, status: "recording"|"transcribing"|"cleaning"|"ready"|"error",
text?: string, error?: string }`.
- **Deep link the app must handle:** `openflow://dictate?rid=<uuid>` (route
  `dictate`, query `rid`). The keyboard mints a fresh `rid` per dictation.
- **Insert-once:** the keyboard clears the consumed entry after inserting, then
  arms a new `rid`. The app should treat each `rid` as single-use.

Full write example for the app is in `targets/keyboard/README.md`.

## Identifiers used (from docs/ARCHITECTURE.md — final)

- App bundle id: `computer.openflow.mobile`
- Keyboard bundle id: `computer.openflow.mobile.keyboard`
- App Group: `group.computer.openflow.mobile`
- URL scheme: `openflow://` (route `dictate`)
- Principal class (required by keyboard Info.plist): `KeyboardViewController`

## appleTeamId — TODO

No Apple account yet. `ios.appleTeamId` is wired to `process.env.APPLE_TEAM_ID`
in `app.config.ts` (and mirrored into the target). `@bacons/apple-targets` only
**warns** when it is empty; `expo prebuild` and the `CODE_SIGNING_ALLOWED=NO`
simulator build in CI both succeed without it. Before any signed/EAS build, set a
real Team ID via the `APPLE_TEAM_ID` env var (and the `APPLE_TEAM_ID` repo secret
consumed by `ios.yml`).

## What CI validates (`.github/workflows/ios.yml`, macos-15)

`npm ci` → `expo prebuild -p ios --no-install` → `pod install` (in `ios/`) →
`xcodebuild -workspace ios/OpenFlow.xcworkspace -scheme OpenFlow -sdk
iphonesimulator -configuration Release CODE_SIGNING_ALLOWED=NO build`
(derivedDataPath `ios/build`). Then it asserts `OpenFlow.app/PlugIns/keyboard.appex`
exists and prints its `RequestsOpenAccess`, zips `OpenFlow.app`, and uploads it as
artifact **`openflow-ios-simulator`**. On failure it prints `xcodebuild -list` and
the build-log tail. Triggers: push to `main`, PRs, and `workflow_dispatch`, gated
to iOS-relevant paths (`targets/**`, `app.config.ts`, `plugins/**`, lockfiles,
the workflow itself).

Xcode 16+ is required on the runner (the generated project uses
`PBXFileSystemSynchronizedRootGroup` buildable folders); macos-15 ships Xcode 16.x.

## Prebuild inspection evidence (local, `expo prebuild -p ios --no-install`)

Verified in the generated (gitignored) `ios/`:

- Keyboard native target present: `productType = com.apple.product-type.app-extension`,
  product `keyboard.appex`, `productName = keyboard`.
- `PRODUCT_BUNDLE_IDENTIFIER = computer.openflow.mobile.keyboard`.
- `INFOPLIST_FILE = ../targets/keyboard/Info.plist` (our hand-authored plist);
  `RequestsOpenAccess` = `true` in it.
- `CODE_SIGN_ENTITLEMENTS` for the keyboard → `../targets/keyboard/generated.entitlements`,
  which contains `com.apple.security.application-groups = [group.computer.openflow.mobile]`.
- Main app `OpenFlow/OpenFlow.entitlements` also carries the same App Group.
- Swift sources compiled via `fileSystemSynchronizedGroups` → the `keyboard`
  buildable folder (`targets/keyboard/`); `Info.plist` + `expo-target.config.js`
  are membership exceptions (not compiled).

## Judgment calls

- **Whole keyboard in SwiftUI** hosted by a `UIHostingController`. The mic _must_
  be a SwiftUI `Link` for the iOS-18-safe user-initiated open, so building the
  whole surface in SwiftUI keeps it consistent. `.simultaneousGesture` writes the
  `recording` state without breaking the Link's open semantics.
- **Value stored as a JSON string** (via `encodeHandoff`), not a plist dictionary.
  This mirrors the shared codec byte-for-byte and avoids type-coercion surprises
  between `ExtensionStorage.setObject` (dict) and Swift decoding.
- **Two keys** (`latest` + per-`rid`) as the task requested. `read(rid:)` checks
  the per-rid key first, then `latest`, and only accepts a payload whose stored
  `rid` matches — guarding against a stale result being inserted.
- **`needsInputModeSwitchKey` read in `viewWillLayoutSubviews`**, not `init` — a
  well-known crash/warning otherwise ("called before a connection was established").
- **Deployment target 16.0** for the extension (SwiftUI `Link`/symbols are safe),
  above Expo's 15.1 app default (an extension may require a newer OS than the app).
- **Symbols pages** (`123` + `#+=`) and caps-lock (long-press shift) added for a
  genuinely usable keyboard, kept minimal per the brief. No key-repeat on delete.
- **`generated.entitlements` gitignored** — it is regenerated from
  `expo-target.config.js` on every prebuild; committing it would only invite drift.
- **Cannot compile locally (no Xcode).** Swift is standard-API only; every
  UIInputViewController/UITextDocumentProxy/UserDefaults signature was checked
  against Apple docs. Compilation is proven by `ios.yml` on a macOS runner.
