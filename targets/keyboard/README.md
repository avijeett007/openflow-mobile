# OpenFlow iOS keyboard extension

A custom system keyboard (`UIInputViewController` + SwiftUI) generated as the
`computer.openflow.mobile.keyboard` Xcode target by
[`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) at
`expo prebuild` time. The native `ios/` project is **not** committed — these
Swift sources + config are the source of truth.

## Files

| File                           | Role                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo-target.config.js`        | Target declaration: `type: "keyboard"`, bundle id, App Group entitlement, deployment target.                                                                                                                                                    |
| `Info.plist`                   | Hand-authored so `RequestsOpenAccess = YES`. Principal class `$(PRODUCT_MODULE_NAME).KeyboardViewController`, `NSExtensionPointIdentifier = com.apple.keyboard-service`.                                                                        |
| `KeyboardViewController.swift` | `UIInputViewController` entry point (class name is **required** by the Info.plist principal class). Hosts the SwiftUI view, reads Full Access / globe capability, reads/writes the App Group hand-off, inserts results via `textDocumentProxy`. |
| `KeyboardModel.swift`          | `ObservableObject` UI state + theme + `KeyboardActions` protocol + the fresh `openflow://dictate?rid=<uuid>` URL.                                                                                                                               |
| `KeyboardView.swift`           | SwiftUI QWERTY keyboard, symbols pages, the mic `Link`, status chip, Full-Access hint / error label.                                                                                                                                            |
| `Handoff.swift`                | `DictationHandoff` Codable + `HandoffStore` (App Group `UserDefaults`). Mirrors `@openflow/shared` exactly.                                                                                                                                     |
| `PrivacyInfo.xcprivacy`        | No tracking / no data collection; declares the `UserDefaults` required-reason API (`CA92.1`).                                                                                                                                                   |
| `generated.entitlements`       | **Generated** by prebuild from `expo-target.config.js` (gitignored).                                                                                                                                                                            |

## How the mic works (iOS 18-safe container-app hop)

Keyboards cannot access the microphone, and iOS 18 blocks programmatic `openURL`
from keyboards. So the mic is a SwiftUI **`Link`** (a user-initiated open) whose
destination is `openflow://dictate?rid=<fresh UUID>`. Tapping it also writes a
`recording` hand-off to the App Group (for the chip). We **never** call
`extensionContext.open` or responder-chain `openURL` tricks. Recording + STT +
cleanup happen in the container app, which writes the result back to the App
Group; on return the keyboard inserts it.

## App Group + hand-off contract (the app side MUST match)

**Suite (App Group):** `group.computer.openflow.mobile`

**Keys** (defined in `Handoff.swift` → `AppGroup`):

| Key                       | Written by                                               | Value                                                      |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `openflow.handoff.latest` | app (progress + result) & keyboard (initial `recording`) | canonical hand-off **JSON string**                         |
| `openflow.handoff.<rid>`  | same                                                     | same JSON string, per-request (authoritative when present) |

**Value format** — the canonical JSON string produced by `@openflow/shared`
`encodeHandoff(...)`. Flat object, field names mirrored exactly in Swift
(`DictationHandoff` / `DictationStatus`):

```jsonc
{
  "rid": "UUID string",              // correlates the keyboard tap with the result
  "status": "recording" | "transcribing" | "cleaning" | "ready" | "error",
  "text": "cleaned dictation…",      // present when status == "ready"
  "error": "message"                 // present when status == "error"
}
```

The app must write the **string** (not a plist dictionary), e.g. with the
package's `ExtensionStorage`:

```ts
import { ExtensionStorage } from '@bacons/apple-targets';
import { encodeHandoff } from '@openflow/shared';

const store = new ExtensionStorage('group.computer.openflow.mobile');
const json = encodeHandoff({ rid, status: 'ready', text });
store.set('openflow.handoff.latest', json);
store.set(`openflow.handoff.${rid}`, json);
```

### Flow

1. Keyboard mint a fresh `rid` → mic `Link` opens `openflow://dictate?rid=<rid>`;
   on tap it writes `{rid, status:"recording"}` to both keys.
2. App foregrounds on the deep link, records, transcribes, cleans, and overwrites
   the same keys as it progresses, ending with `{rid, status:"ready", text}`
   (or `{rid, status:"error", error}`).
3. User taps the system "‹ back" breadcrumb → keyboard `viewWillAppear` reads the
   hand-off for its pending `rid`. On `ready` it `insertText(text)` and clears the
   entry (insert-once); on `error` it shows a brief error label. Then it arms a
   fresh `rid` for the next dictation.

Reading/writing the App Group requires **Full Access**. Without it the basic
QWERTY layer still works and a "Enable Full Access for dictation" hint is shown
(App Review requires a functional keyboard without Full Access).
