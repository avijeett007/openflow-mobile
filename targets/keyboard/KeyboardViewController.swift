import SwiftUI
import UIKit

/// OpenFlow custom keyboard. Principal class referenced by Info.plist
/// (`$(PRODUCT_MODULE_NAME).KeyboardViewController`) — do not rename.
///
/// Design constraints (see docs/ARCHITECTURE.md):
///  - Keyboards cannot access the mic. Recording happens in the container app.
///  - iOS 18 blocks programmatic `openURL` from keyboards, so the mic is a SwiftUI
///    `Link` (user-initiated open). We NEVER call `extensionContext.open` or
///    responder-chain `openURL` tricks.
///  - The basic QWERTY layer must work WITHOUT Full Access (App Review requirement).
class KeyboardViewController: UIInputViewController, KeyboardActions {
    private let model = KeyboardModel()
    private let store = HandoffStore()
    private var host: UIHostingController<KeyboardView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        model.actions = self

        let hosting = UIHostingController(rootView: KeyboardView(model: model))
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        hosting.didMove(toParent: self)
        self.host = hosting

        // Give the keyboard a concrete height (SwiftUI content has no intrinsic
        // keyboard height). Priority < required to avoid clashing with system
        // constraints during rotation/resize.
        let height = view.heightAnchor.constraint(equalToConstant: 268)
        height.priority = UILayoutPriority(999)
        height.isActive = true
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshCapabilities()
        consumePendingResult()
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        // Safe to read here — the host connection is established by layout time.
        model.needsGlobe = needsInputModeSwitchKey
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        // Keep capability flags fresh when the edited field changes.
        refreshCapabilities()
    }

    private func refreshCapabilities() {
        model.hasFullAccess = hasFullAccess
        model.needsGlobe = needsInputModeSwitchKey
    }

    /// On becoming active, pull any dictation result the app wrote to the App Group.
    private func consumePendingResult() {
        // App Group requires Full Access; QWERTY still works without it.
        guard hasFullAccess, let result = store.read(rid: model.pendingRID) else { return }
        switch result.status {
        case .ready:
            if let text = result.text, !text.isEmpty {
                textDocumentProxy.insertText(text)
            }
            store.clear(rid: result.rid)
            model.status = nil
            model.errorText = nil
            model.regenerateDictateURL()   // arm a fresh rid for the next dictation
        case .error:
            model.errorText = result.error ?? "Dictation failed. Try again."
            model.status = .error
            store.clear(rid: result.rid)
            model.regenerateDictateURL()
        case .recording, .transcribing, .cleaning:
            // Returned mid-flight — reflect progress in the chip, keep waiting.
            model.status = result.status
        }
    }

    // MARK: - KeyboardActions

    func insert(_ text: String) {
        textDocumentProxy.insertText(text)
        if model.shift && !model.capsLock {
            model.shift = false   // one-shot shift
        }
    }

    func deleteBackward() {
        textDocumentProxy.deleteBackward()
    }

    func advanceToNextKeyboard() {
        advanceToNextInputMode()
    }

    func onDictateTapped(rid: String) {
        // The SwiftUI Link performs the user-initiated open; we only mark state.
        model.status = .recording
        model.errorText = nil
        if hasFullAccess {
            store.writeRecording(rid: rid)
        }
    }
}
