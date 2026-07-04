import Foundation

// MARK: - Hand-off contract (mirrors @openflow/shared `DictationHandoff`)
//
// This MUST match `shared/src/handoff/index.ts` EXACTLY. Flat, additive-only.
//   { rid: string, status: enum, text?: string, error?: string }
// The container app serialises this with `encodeHandoff()` (canonical JSON string)
// and writes it to the App Group (see AppGroupStore). The keyboard decodes it here.

enum DictationStatus: String, Codable {
    case recording
    case transcribing
    case cleaning
    case ready
    case error
}

struct DictationHandoff: Codable {
    let rid: String
    let status: DictationStatus
    let text: String?
    let error: String?

    init(rid: String, status: DictationStatus, text: String? = nil, error: String? = nil) {
        self.rid = rid
        self.status = status
        self.text = text
        self.error = error
    }
}

// MARK: - App Group storage

/// Shared App Group + hand-off keys. The container app (chunk C2) MUST use the
/// same suite + keys and write the canonical JSON string from `encodeHandoff()`.
/// Documented in targets/keyboard/README.md and docs/NOTES-C3.md.
enum AppGroup {
    static let suiteName = "group.computer.openflow.mobile"

    /// Latest hand-off payload (JSON string). Overwritten as the flow progresses.
    static let latestKey = "openflow.handoff.latest"

    /// Optional per-request key, authoritative when present: `openflow.handoff.<rid>`.
    static func key(for rid: String) -> String { "openflow.handoff.\(rid)" }
}

/// Reads/writes the dictation hand-off in the shared App Group `UserDefaults`.
/// Requires Full Access (open access) — callers guard on `hasFullAccess`.
struct HandoffStore {
    private let defaults: UserDefaults?

    init() {
        self.defaults = UserDefaults(suiteName: AppGroup.suiteName)
    }

    /// Written on the mic tap so the app + chip immediately reflect `recording`.
    func writeRecording(rid: String) {
        write(DictationHandoff(rid: rid, status: .recording))
    }

    func write(_ payload: DictationHandoff) {
        guard let defaults,
              let data = try? JSONEncoder().encode(payload),
              let json = String(data: data, encoding: .utf8) else { return }
        defaults.set(json, forKey: AppGroup.latestKey)
        defaults.set(json, forKey: AppGroup.key(for: payload.rid))
    }

    /// Returns the hand-off for `rid` (rid-specific key first, then `latest`),
    /// only if the stored rid actually matches (guards against a stale payload).
    func read(rid: String) -> DictationHandoff? {
        if let payload = decode(AppGroup.key(for: rid)), payload.rid == rid {
            return payload
        }
        if let payload = decode(AppGroup.latestKey), payload.rid == rid {
            return payload
        }
        return nil
    }

    func readLatest() -> DictationHandoff? {
        decode(AppGroup.latestKey)
    }

    /// Clears a consumed payload so it is inserted exactly once.
    func clear(rid: String) {
        guard let defaults else { return }
        defaults.removeObject(forKey: AppGroup.key(for: rid))
        if let latest = readLatest(), latest.rid == rid {
            defaults.removeObject(forKey: AppGroup.latestKey)
        }
    }

    private func decode(_ key: String) -> DictationHandoff? {
        guard let defaults,
              let json = defaults.string(forKey: key),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(DictationHandoff.self, from: data)
    }
}
