import ExpoModulesCore
import NaturalLanguage
import Speech
import SwiftUI
import Translation

// MARK: - Constants

/// Apple's transient error for an installed pair whose models momentarily aren't
/// loadable (Domain=TranslationErrorDomain Code=16 "Offline models not
/// available"). The spec mandates a single retry on it. See docs/NOTES-T2.md.
private let kTranslationErrorDomain = "TranslationErrorDomain"
private let kTranslationOfflineModelsCode = 16

// MARK: - Module

/**
 * modules/translator (iOS). Wraps the Apple Translation framework (iOS 18+),
 * `NLLanguageRecognizer` and `SFSpeechRecognizer` behind the frozen JS surface
 * (DESIGN-mobile-translator.md).
 *
 * The module ALWAYS loads (so the JS layer + iOS 16/17 report a clean
 * "unavailable"). Everything that touches the Translation framework is
 * runtime-gated with `#available(iOS 18.0, *)`; the iOS 26 headless fast path is
 * gated with `#available(iOS 26.0, *)`.
 *
 * Sessions are obtained via an invisible 1×1 hosted SwiftUI `.translationTask`
 * view attached to the key window (see `TranslatorCoordinator`), because on
 * iOS 18–25 a `TranslationSession` can ONLY be vended by that SwiftUI modifier.
 */
public final class TranslatorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Translator")

    // MARK: translate → { text: String }
    AsyncFunction("translate") { (text: String, from: String, to: String) async throws -> [String: String] in
      guard #available(iOS 18.0, *) else {
        throw Exception(name: "ERR_UNAVAILABLE", description: iOS18Reason)
      }
      let out = try await TranslatorCoordinator.shared.translate(text: text, from: from, to: to)
      return ["text": out]
    }

    // MARK: getPairStatus
    AsyncFunction("getPairStatus") { (from: String, to: String) async -> String in
      guard #available(iOS 18.0, *) else { return "unsupported" }
      return await TranslatorCoordinator.shared.pairStatus(from: from, to: to)
    }

    // MARK: downloadPack — hosted prepareTranslation() (system consent sheet).
    // `wifiOnly` is accepted for surface parity but ignored on iOS: the system
    // download UI governs network use, not the app.
    AsyncFunction("downloadPack") { (from: String, to: String, _ wifiOnly: Bool) async throws in
      guard #available(iOS 18.0, *) else {
        throw Exception(name: "ERR_UNAVAILABLE", description: iOS18Reason)
      }
      try await TranslatorCoordinator.shared.downloadPack(from: from, to: to)
    }

    // MARK: listSupportedLanguages
    AsyncFunction("listSupportedLanguages") { () async -> [String] in
      guard #available(iOS 18.0, *) else { return [] }
      return await TranslatorCoordinator.shared.supportedLanguages()
    }

    // MARK: listDownloadedLanguages
    AsyncFunction("listDownloadedLanguages") { () async -> [String] in
      guard #available(iOS 18.0, *) else { return [] }
      return await TranslatorCoordinator.shared.downloadedLanguages()
    }

    // MARK: deletePack — iOS packs are system-managed (Settings ▸ Apps ▸ Translate).
    AsyncFunction("deletePack") { (_ lang: String) -> Bool in
      return false
    }

    // MARK: identifyLanguage (NLLanguageRecognizer — iOS 12+, no gate)
    AsyncFunction("identifyLanguage") { (text: String) -> String? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      // dominantLanguage is nil when undetermined — maps to JS `null`.
      return recognizer.dominantLanguage?.rawValue
    }

    // MARK: sttOnDeviceLocales (SFSpeechRecognizer — iOS 13+, no gate)
    AsyncFunction("sttOnDeviceLocales") { () -> [String]? in
      let locales = SFSpeechRecognizer.supportedLocales().filter { locale in
        SFSpeechRecognizer(locale: locale)?.supportsOnDeviceRecognition ?? false
      }
      // BCP-47 identifiers ("en-US"), not the underscore form.
      return locales.map { $0.identifier(.bcp47) }.sorted()
    }

    // MARK: isTranslationAvailable → { available: Bool, reason?: String }
    AsyncFunction("isTranslationAvailable") { () -> [String: Any] in
      #if targetEnvironment(simulator)
        return [
          "available": false,
          "reason": "On-device translation is not supported in the iOS Simulator — test on a device.",
        ]
      #else
        if #available(iOS 18.0, *) {
          return ["available": true]
        }
        return ["available": false, "reason": iOS18Reason]
      #endif
    }
  }
}

private let iOS18Reason = "On-device translation requires iOS 18 or later."

// MARK: - Hosted session job

/// A unit of work handed to the live `TranslationSession` running inside the
/// hosted `.translationTask` closure. `resolve` fulfils the awaiting caller.
@available(iOS 18.0, *)
private struct TranslationJob {
  enum Kind { case translate, prepare }
  let kind: Kind
  let text: String
  let resolve: (Result<String, Error>) -> Void
}

// MARK: - Coordinator

/**
 * Owns the invisible hosted SwiftUI view, the per-(from,to) configuration, and
 * an actor-style serial pipeline. A single async "lock" guarantees one
 * translate/prepare is in flight at a time; the live session is reused for
 * repeated calls on the same pair and recreated (new Configuration → the
 * `.translationTask` closure restarts with a fresh session) whenever the pair
 * changes. Reusing a session across config changes would `fatalError`, so we
 * never do.
 *
 * The `TranslationSession` never crosses an actor boundary: it lives entirely
 * inside the `.translationTask` closure, which pulls `TranslationJob`s from an
 * `AsyncStream` this object vends.
 */
@available(iOS 18.0, *)
@MainActor
final class TranslatorCoordinator: ObservableObject {
  static let shared = TranslatorCoordinator()

  // Drives `.translationTask`; changing it restarts the closure with a new session.
  @Published var configuration: TranslationSession.Configuration?

  private var hostingController: UIHostingController<HostedTranslatorView>?

  private var currentPairKey: String?
  private var streamContinuation: AsyncStream<TranslationJob>.Continuation?
  private var awaitingFreshStream = false
  private var pendingJobs: [TranslationJob] = []
  private var streamGeneration = 0

  // Simple async mutex (serial pipeline).
  private var locked = false
  private var lockWaiters: [CheckedContinuation<Void, Never>] = []

  private init() {}

  // MARK: Public operations

  func translate(text: String, from: String, to: String) async throws -> String {
    // iOS 26 headless fast path for INSTALLED pairs — no hosted view needed.
    if #available(iOS 26.0, *) {
      if let out = try await headlessTranslateIfInstalled(text: text, from: from, to: to) {
        return out
      }
    }
    await acquireLock()
    defer { releaseLock() }
    try ensureHosted()
    reconfigureIfNeeded(from: from, to: to)
    return try await runJob(kind: .translate, text: text)
  }

  func downloadPack(from: String, to: String) async throws {
    await acquireLock()
    defer { releaseLock() }
    try ensureHosted()
    reconfigureIfNeeded(from: from, to: to)
    _ = try await runJob(kind: .prepare, text: "")
  }

  func pairStatus(from: String, to: String) async -> String {
    let status = await LanguageAvailability().status(
      from: Locale.Language(identifier: from),
      to: Locale.Language(identifier: to)
    )
    switch status {
    case .installed: return "installed"
    case .supported: return "downloadable"
    case .unsupported: return "unsupported"
    @unknown default: return "unsupported"
    }
  }

  func supportedLanguages() async -> [String] {
    let langs = await LanguageAvailability().supportedLanguages
    // minimalIdentifier yields Apple's canonical tags, incl. script where it
    // matters (e.g. "zh-Hans"). The pure-TS mapping layer reconciles these.
    return langs.map { $0.minimalIdentifier }.sorted()
  }

  /// iOS exposes availability per *pair*, not per language, and offers no
  /// "downloaded packs" list. We approximate: a language counts as downloaded
  /// if translating it to/from the device language reports `.installed`.
  /// Documented as best-effort in docs/NOTES-T2.md.
  func downloadedLanguages() async -> [String] {
    let availability = LanguageAvailability()
    let device = Locale.current.language
    let all = await availability.supportedLanguages
    var result: [String] = []
    for lang in all {
      let toDevice = await availability.status(from: lang, to: device)
      let fromDevice = await availability.status(from: device, to: lang)
      if toDevice == .installed || fromDevice == .installed {
        result.append(lang.minimalIdentifier)
      }
    }
    return result.sorted()
  }

  // MARK: iOS 26 headless

  @available(iOS 26.0, *)
  private func headlessTranslateIfInstalled(text: String, from: String, to: String) async throws -> String? {
    let source = Locale.Language(identifier: from)
    let target = Locale.Language(identifier: to)
    let status = await LanguageAvailability().status(from: source, to: target)
    guard status == .installed else { return nil }
    let session = TranslationSession(installedSource: source, target: target)
    return try await translateOnceWithRetry(session, text)
  }

  // (retry helper is a free function — see `translateOnceWithRetry` below — so the
  // non-Sendable TranslationSession never crosses an actor boundary.)

  // MARK: Hosted plumbing

  private func ensureHosted() throws {
    guard hostingController == nil else { return }
    guard let window = Self.keyWindow() else {
      throw Exception(
        name: "ERR_NO_WINDOW",
        description: "No key window is available to host the translation session yet."
      )
    }
    let host = UIHostingController(rootView: HostedTranslatorView(model: self))
    host.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    host.view.isUserInteractionEnabled = false
    host.view.backgroundColor = .clear
    host.view.alpha = 0
    window.addSubview(host.view)
    if let root = window.rootViewController {
      root.addChild(host)
      host.didMove(toParent: root)
    }
    hostingController = host
  }

  private func reconfigureIfNeeded(from: String, to: String) {
    let key = "\(from)|\(to)"
    if key == currentPairKey, configuration != nil { return }
    currentPairKey = key
    awaitingFreshStream = true
    // A brand-new Configuration per pair → the `.translationTask` closure
    // restarts with a fresh session (never reuse a session across pairs).
    configuration = TranslationSession.Configuration(
      source: Locale.Language(identifier: from),
      target: Locale.Language(identifier: to)
    )
  }

  private func runJob(kind: TranslationJob.Kind, text: String) async throws -> String {
    try await withCheckedThrowingContinuation { cont in
      let job = TranslationJob(kind: kind, text: text) { result in
        cont.resume(with: result)
      }
      enqueue(job)
    }
  }

  private func enqueue(_ job: TranslationJob) {
    if let cont = streamContinuation, !awaitingFreshStream {
      cont.yield(job)
    } else {
      pendingJobs.append(job)
    }
  }

  /// Vended once per `.translationTask` invocation. Adopts any jobs queued while
  /// the session was being (re)configured.
  func makeStream() -> AsyncStream<TranslationJob> {
    streamGeneration += 1
    let gen = streamGeneration
    return AsyncStream { continuation in
      self.streamContinuation = continuation
      self.awaitingFreshStream = false
      let queued = self.pendingJobs
      self.pendingJobs.removeAll()
      for job in queued { continuation.yield(job) }
      continuation.onTermination = { [weak self] _ in
        Task { @MainActor in self?.streamTerminated(gen) }
      }
    }
  }

  private func streamTerminated(_ gen: Int) {
    // Only clear if this is still the current stream (a newer one may have
    // replaced it on a pair change).
    if gen == streamGeneration {
      streamContinuation = nil
    }
  }

  // MARK: Serial lock

  private func acquireLock() async {
    while locked {
      await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
        lockWaiters.append(cont)
      }
    }
    locked = true
  }

  private func releaseLock() {
    locked = false
    if !lockWaiters.isEmpty {
      lockWaiters.removeFirst().resume()
    }
  }

  // MARK: Helpers

  private static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    return windows.first { $0.isKeyWindow } ?? windows.first
  }
}

// MARK: - Translate-with-retry (free function, no actor isolation)

/// Translate a single string, retrying ONCE on the transient
/// `TranslationErrorDomain` Code 16 ("offline models not available"). Kept
/// non-isolated so the non-Sendable `TranslationSession` never crosses an actor
/// boundary (callers: the hosted view closure and the iOS 26 headless path).
@available(iOS 18.0, *)
private func translateOnceWithRetry(_ session: TranslationSession, _ text: String) async throws -> String {
  do {
    return try await session.translate(text).targetText
  } catch let error as NSError
    where error.domain == kTranslationErrorDomain && error.code == kTranslationOfflineModelsCode {
    return try await session.translate(text).targetText
  }
}

// MARK: - Hosted SwiftUI view

/// Invisible 1×1 view whose only job is to own the `.translationTask` session.
/// It pulls `TranslationJob`s from the coordinator's stream and processes them
/// against the live session (which never leaves this closure).
@available(iOS 18.0, *)
private struct HostedTranslatorView: View {
  @ObservedObject var model: TranslatorCoordinator

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .opacity(0)
      .allowsHitTesting(false)
      .translationTask(model.configuration) { session in
        let stream = await model.makeStream()
        for await job in stream {
          switch job.kind {
          case .translate:
            do {
              let text = try await translateOnceWithRetry(session, job.text)
              job.resolve(.success(text))
            } catch {
              job.resolve(.failure(error))
            }
          case .prepare:
            do {
              try await session.prepareTranslation()
              job.resolve(.success(""))
            } catch {
              job.resolve(.failure(error))
            }
          }
        }
      }
  }
}
