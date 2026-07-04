package computer.openflow.mobile.ime

import org.json.JSONObject

/**
 * Pure-JVM decision + string logic for the **local (on-device) STT** mode.
 *
 * IMPORTANT: like [OpenFlowHttp], this file MUST NOT import anything from
 * `android.*`. It is compiled into the app but exercised on the plain JVM by
 * `./gradlew testDebugUnitTest` (see `LocalSttLogicTest`), so it may only use
 * `java.*` + `org.json`. The Android glue lives in [LocalSttEngine], which is
 * device-only; every branch worth testing (mode selection, cleanup gating, and
 * error-code → human-message mapping) is extracted here so it can be unit-tested
 * without a device or a `SpeechRecognizer`.
 *
 * The ONLY new cross-agent contract is the `stt.mode` string in the settings
 * JSON that the IME already reads: the exact value `"local"` selects the
 * on-device path; everything else (including `"remote"`, `"selfHosted"`,
 * unknown, or missing) keeps the existing record-WAV + HTTP path.
 */
object LocalSttLogic {
  /** Which transcription pipeline the IME should run for the current settings. */
  enum class SttPath { LOCAL, REMOTE }

  /** The one magic string that opts into on-device recognition. */
  const val MODE_LOCAL = "local"

  /**
   * Decide [SttPath.LOCAL] vs [SttPath.REMOTE] from the persisted settings JSON.
   *
   * Only an exact `stt.mode == "local"` selects the on-device engine. A null /
   * blank / malformed JSON, a missing `stt` object, a missing `mode`, or any
   * other mode value (`"remote"`, `"selfHosted"`, future/unknown) all fall back
   * to REMOTE — i.e. the pre-existing behaviour, so nothing regresses.
   */
  fun decideSttPath(settingsJson: String?): SttPath {
    if (settingsJson.isNullOrBlank()) return SttPath.REMOTE
    val mode = try {
      JSONObject(settingsJson).optJSONObject("stt")?.optStringOrNull("mode")
    } catch (_: Exception) {
      null
    }
    return if (mode == MODE_LOCAL) SttPath.LOCAL else SttPath.REMOTE
  }

  /**
   * Local mode transcribes entirely on-device, so it NEVER needs an STT API key.
   * Kept as an explicit predicate (rather than an inline `false`) so the "local
   * requires no key" invariant is pinned by a unit test and documented in one
   * place.
   */
  fun localModeNeedsSttKey(): Boolean = false

  /**
   * Cleanup gate for the local path: run the (networked) LLM cleanup step only
   * when it is **enabled AND a cleanup key is available**. In local mode the user
   * may have no API keys at all; if cleanup is enabled but no key is present we
   * commit the raw on-device transcript rather than erroring.
   *
   * `hasCleanupKey` is supplied by the caller and is true when a secret is stored
   * for the cleanup provider OR the provider is keyless (e.g. Ollama) — see
   * [OpenFlowIme].
   */
  fun shouldRunCleanup(enabled: Boolean, hasCleanupKey: Boolean): Boolean =
    enabled && hasCleanupKey

  // ---- SpeechRecognizer error-code → human message ------------------------

  // These mirror the public `android.speech.SpeechRecognizer.ERROR_*` int values
  // 1:1. They are re-declared here (instead of referencing SpeechRecognizer) so
  // this file stays pure-JVM and the mapping is unit-testable off-device. If the
  // platform ever renumbers these (it has not since API 8), update both.
  const val ERROR_NETWORK_TIMEOUT = 1
  const val ERROR_NETWORK = 2
  const val ERROR_AUDIO = 3
  const val ERROR_SERVER = 4
  const val ERROR_CLIENT = 5
  const val ERROR_SPEECH_TIMEOUT = 6
  const val ERROR_NO_MATCH = 7
  const val ERROR_RECOGNIZER_BUSY = 8
  const val ERROR_INSUFFICIENT_PERMISSIONS = 9
  const val ERROR_TOO_MANY_REQUESTS = 10
  const val ERROR_SERVER_DISCONNECTED = 11
  const val ERROR_LANGUAGE_NOT_SUPPORTED = 12
  const val ERROR_LANGUAGE_UNAVAILABLE = 13
  const val ERROR_CANNOT_CHECK_SUPPORT = 14

  /**
   * Synthetic code (NOT a SpeechRecognizer constant — negative so it can never
   * collide with a real one) meaning "no usable recognition engine on this
   * device". Surfaced by [LocalSttEngine] so the UI can say the on-device
   * feature is unavailable.
   */
  const val ERROR_ENGINE_UNAVAILABLE = -1

  /** Map a [SpeechRecognizer]-style error code to a short user-facing message. */
  fun errorMessage(code: Int): String = when (code) {
    ERROR_ENGINE_UNAVAILABLE -> "On-device recognition unavailable on this phone"
    ERROR_NETWORK_TIMEOUT -> "Network timed out"
    ERROR_NETWORK -> "Network error"
    ERROR_AUDIO -> "Audio recording error"
    ERROR_SERVER -> "Recognition server error"
    ERROR_CLIENT -> "Recognition stopped"
    ERROR_SPEECH_TIMEOUT -> "No speech detected — tap the mic to try again"
    ERROR_NO_MATCH -> "Didn't catch that"
    ERROR_RECOGNIZER_BUSY -> "Recognizer is busy — try again"
    ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required"
    ERROR_TOO_MANY_REQUESTS -> "Too many requests — try again shortly"
    ERROR_SERVER_DISCONNECTED -> "Recognition service disconnected"
    ERROR_LANGUAGE_NOT_SUPPORTED -> "This language isn't supported on-device"
    ERROR_LANGUAGE_UNAVAILABLE -> "Language pack unavailable — install it in system settings"
    ERROR_CANNOT_CHECK_SUPPORT -> "Couldn't check on-device support"
    else -> "Speech recognition error ($code)"
  }

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key) else null
}
