# targets/ — iOS keyboard extension (placeholder)

**Owner: chunk C3 (iOS keyboard + expo-apple-targets).**

This directory will hold the iOS **keyboard extension** (Swift) authored for
[`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets)
(a.k.a. expo-apple-targets). The plugin generates the extension Xcode target at
`expo prebuild` time; the native `ios/` project is **not** committed.

## What goes here (C3)
- `keyboard/` — SwiftUI keyboard `UIInputViewController` with:
  - a mic button as a SwiftUI `Link` opening `openflow://dictate?rid=<uuid>`
    (iOS 18+ blocks programmatic `openURL` from keyboards — must be user-initiated),
  - a status chip driven by the App Group hand-off payload
    (`recording` / `transcribing` / `cleaning` / `ready` / `error`),
  - `textDocumentProxy.insertText` on `ready`.
- `expo-target.config.js` — target type `keyboard`, entitlements for App Group
  `group.computer.openflow.mobile` and Keychain access group
  `$(AppIdentifierPrefix)computer.openflow.mobile.shared`, `RequestsOpenAccess = YES`.
- `PrivacyInfo.xcprivacy`.

## Contract
The keyboard reads/writes the flat hand-off JSON defined by
`@openflow/shared` (`DictationHandoff`). It NEVER records audio or networks —
recording + STT + cleanup happen in the container app. See
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
