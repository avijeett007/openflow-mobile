import SwiftUI

// MARK: - Root

/// The OpenFlow keyboard UI. Hosted by `KeyboardViewController` via
/// `UIHostingController`. Pure presentation — every action is delegated back to
/// the controller through `model.actions` (KeyboardActions).
struct KeyboardView: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 6) {
            DictationBar(model: model)
            StatusLine(model: model)
            KeysArea(model: model)
        }
        .padding(.horizontal, 3)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}

// MARK: - Dictation bar (mic Link + status chip)

private struct DictationBar: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 8) {
            // iOS 18-safe: a user-initiated `Link` open. The container app records.
            Link(destination: model.dictateURL) {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill")
                    Text("Dictate").fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .foregroundColor(.white)
                .background(Theme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .simultaneousGesture(
                TapGesture().onEnded {
                    // Record `recording` state alongside the Link's URL open.
                    model.actions?.onDictateTapped(rid: model.pendingRID)
                }
            )

            StatusChip(status: model.status)
        }
        .padding(.horizontal, 3)
    }
}

private struct StatusChip: View {
    let status: DictationStatus?

    var body: some View {
        if let status, let info = StatusChip.info(for: status) {
            HStack(spacing: 6) {
                Circle().fill(info.color).frame(width: 8, height: 8)
                Text(info.label).font(.caption).foregroundColor(Theme.keyText)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(Theme.keyFunction)
            .clipShape(Capsule())
        }
    }

    private static func info(for status: DictationStatus) -> (label: String, color: Color)? {
        switch status {
        case .recording: return ("Recording", Theme.recording)
        case .transcribing: return ("Transcribing", Theme.working)
        case .cleaning: return ("Cleaning", Theme.working)
        case .ready: return ("Ready", Theme.ready)
        case .error: return nil   // shown as an inline error label instead
        }
    }
}

private struct StatusLine: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        Group {
            if let error = model.errorText {
                line(error, system: "exclamationmark.triangle.fill", color: Theme.danger)
            } else if !model.hasFullAccess {
                line("Enable Full Access for dictation", system: "lock.fill", color: Theme.mutedText)
            }
        }
    }

    private func line(_ text: String, system: String, color: Color) -> some View {
        Label(text, systemImage: system)
            .font(.footnote)
            .foregroundColor(color)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
    }
}

// MARK: - Keys

private struct KeysArea: View {
    @ObservedObject var model: KeyboardModel

    private let lettersTop = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]
    private let lettersMid = ["a", "s", "d", "f", "g", "h", "j", "k", "l"]
    private let lettersLow = ["z", "x", "c", "v", "b", "n", "m"]

    var body: some View {
        VStack(spacing: 6) {
            switch model.page {
            case .letters:
                lettersLayout
            case .symbols:
                symbolsLayout(extra: false)
            case .symbolsExtra:
                symbolsLayout(extra: true)
            }
            bottomRow
        }
    }

    // MARK: Letters

    private var lettersLayout: some View {
        VStack(spacing: 6) {
            LettersRow(keys: cased(lettersTop), model: model)
            LettersRow(keys: cased(lettersMid), model: model)
                .padding(.horizontal, 16)
            HStack(spacing: 6) {
                ShiftKey(model: model).frame(width: 44)
                LettersRow(keys: cased(lettersLow), model: model)
                FunctionKey(system: "delete.left") { model.actions?.deleteBackward() }
                    .frame(width: 44)
            }
        }
    }

    private func cased(_ keys: [String]) -> [String] {
        (model.shift || model.capsLock) ? keys.map { $0.uppercased() } : keys
    }

    // MARK: Symbols

    private func symbolsLayout(extra: Bool) -> some View {
        let row1 = extra
            ? ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]
            : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
        let row2 = extra
            ? ["_", "\\", "|", "~", "<", ">", "\u{20AC}", "\u{00A3}", "\u{00A5}", "\u{2022}"]
            : ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""]
        let row3 = [".", ",", "?", "!", "'"]
        return VStack(spacing: 6) {
            LettersRow(keys: row1, model: model)
            LettersRow(keys: row2, model: model)
            HStack(spacing: 6) {
                LabelKey(text: extra ? "123" : "#+=", fill: Theme.keyFunction, fontSize: 16) {
                    model.page = extra ? .symbols : .symbolsExtra
                }
                .frame(width: 60)
                LettersRow(keys: row3, model: model)
                FunctionKey(system: "delete.left") { model.actions?.deleteBackward() }
                    .frame(width: 44)
            }
        }
    }

    // MARK: Bottom row

    private var bottomRow: some View {
        HStack(spacing: 6) {
            LabelKey(text: model.page == .letters ? "123" : "ABC", fill: Theme.keyFunction, fontSize: 16) {
                model.page = (model.page == .letters) ? .symbols : .letters
            }
            .frame(width: 60)

            if model.needsGlobe {
                FunctionKey(system: "globe") { model.actions?.advanceToNextKeyboard() }
                    .frame(width: 44)
            }

            LabelKey(text: "space", fill: Theme.keyFill, fontSize: 16) {
                model.actions?.insert(" ")
            }

            LabelKey(text: "return", fill: Theme.keyFunction, fontSize: 16) {
                model.actions?.insert("\n")
            }
            .frame(width: 92)
        }
    }
}

// MARK: - Reusable key views

private struct LettersRow: View {
    let keys: [String]
    let model: KeyboardModel

    var body: some View {
        HStack(spacing: 6) {
            ForEach(keys, id: \.self) { key in
                LabelKey(text: key) { model.actions?.insert(key) }
            }
        }
    }
}

private struct LabelKey: View {
    let text: String
    var fill: Color = Theme.keyFill
    var textColor: Color = Theme.keyText
    var fontSize: CGFloat = 22
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: fontSize))
                .foregroundColor(textColor)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(fill)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct FunctionKey: View {
    let system: String
    var active: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(active ? .black : Theme.keyText)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(active ? Theme.accent : Theme.keyFunction)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct ShiftKey: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        let symbol = model.capsLock ? "capslock.fill" : (model.shift ? "shift.fill" : "shift")
        let active = model.shift || model.capsLock
        FunctionKey(system: symbol, active: active) {
            if model.capsLock {
                model.capsLock = false
                model.shift = false
            } else {
                model.shift.toggle()
            }
        }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.3).onEnded { _ in
                model.capsLock = true
                model.shift = false
            }
        )
    }
}
