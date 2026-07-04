import SwiftUI

// MARK: - Theme (OpenFlow dark, violet #7C5CFF accent)

enum Theme {
    static let accent = Color(red: 124.0 / 255.0, green: 92.0 / 255.0, blue: 255.0 / 255.0)
    static let background = Color(red: 0.11, green: 0.11, blue: 0.12)   // keyboard tray
    static let keyFill = Color(red: 0.24, green: 0.24, blue: 0.26)      // letter keys
    static let keyFunction = Color(red: 0.17, green: 0.17, blue: 0.19)  // shift/⌫/123
    static let keyText = Color.white
    static let mutedText = Color(white: 0.7)
    static let danger = Color(red: 1.0, green: 0.42, blue: 0.42)
    static let recording = Color(red: 1.0, green: 0.35, blue: 0.35)
    static let working = Color(red: 1.0, green: 0.78, blue: 0.35)
    static let ready = Color(red: 0.4, green: 0.85, blue: 0.55)
}

// MARK: - Actions the SwiftUI view asks the input view controller to perform

protocol KeyboardActions: AnyObject {
    func insert(_ text: String)
    func deleteBackward()
    func advanceToNextKeyboard()
    /// User tapped the mic. The SwiftUI `Link` performs the actual URL open;
    /// this only records the `recording` hand-off + chip state for `rid`.
    func onDictateTapped(rid: String)
}

// MARK: - Observable UI state shared between the controller and the SwiftUI view

final class KeyboardModel: ObservableObject {
    enum Page {
        case letters
        case symbols        // 123 / punctuation
        case symbolsExtra   // #+=
    }

    @Published var page: Page = .letters
    @Published var shift: Bool = true          // auto-capitalise the first letter
    @Published var capsLock: Bool = false
    @Published var needsGlobe: Bool = false     // driven by needsInputModeSwitchKey
    @Published var hasFullAccess: Bool = false
    @Published var status: DictationStatus? = nil   // drives the status chip
    @Published var errorText: String? = nil

    weak var actions: KeyboardActions?

    // The mic Link opens this URL; `pendingRID` correlates the result. Regenerated
    // only after a result is consumed so a returning user's payload still matches.
    @Published private(set) var dictateURL: URL
    @Published private(set) var pendingRID: String

    init() {
        let made = KeyboardModel.makeDictate()
        self.dictateURL = made.url
        self.pendingRID = made.rid
    }

    func regenerateDictateURL() {
        let made = KeyboardModel.makeDictate()
        dictateURL = made.url
        pendingRID = made.rid
    }

    private static func makeDictate() -> (url: URL, rid: String) {
        let rid = UUID().uuidString
        // Fresh rid per dictation; matches openflow://dictate route in the app.
        let url = URL(string: "openflow://dictate?rid=\(rid)")!
        return (url, rid)
    }
}
