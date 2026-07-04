package computer.openflow.mobile.ime

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [LocalSttLogic] — the pure decision + string logic behind
 * the local (on-device) STT mode. `SpeechRecognizer` itself is not JVM-testable,
 * so every testable branch is extracted here: the `stt.mode` → path decision
 * (incl. the unknown/missing default and the local-needs-no-key invariant), the
 * cleanup gate, and the error-code → message mapping.
 *
 * Runs on the plain JVM via `./gradlew testDebugUnitTest` alongside
 * [OpenFlowHttpContractTest]; no device, no `android.*`.
 */
class LocalSttLogicTest {

  private fun settings(mode: String?): String {
    val stt = JSONObject().put("provider", "groq").put("model", "whisper")
    if (mode != null) stt.put("mode", mode)
    return JSONObject().put("stt", stt).toString()
  }

  // ---- decideSttPath -------------------------------------------------------

  @Test
  fun localMode_selectsLocalPath() {
    assertEquals(LocalSttLogic.SttPath.LOCAL, LocalSttLogic.decideSttPath(settings("local")))
  }

  @Test
  fun remoteAndSelfHosted_selectRemotePath() {
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(settings("remote")))
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(settings("selfHosted")))
  }

  @Test
  fun unknownMode_defaultsToRemote() {
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(settings("cloud-v9")))
  }

  @Test
  fun missingMode_defaultsToRemote() {
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(settings(null)))
  }

  @Test
  fun missingSttObject_defaultsToRemote() {
    assertEquals(
      LocalSttLogic.SttPath.REMOTE,
      LocalSttLogic.decideSttPath(JSONObject().put("cleanup", JSONObject()).toString()),
    )
  }

  @Test
  fun nullBlankAndMalformedJson_defaultToRemote() {
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(null))
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(""))
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath("   "))
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath("{not valid json"))
  }

  @Test
  fun modeMatchIsCaseSensitiveExact() {
    // Only the exact lowercase "local" opts in.
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(settings("Local")))
    assertEquals(LocalSttLogic.SttPath.REMOTE, LocalSttLogic.decideSttPath(settings("LOCAL")))
  }

  // ---- local needs no key --------------------------------------------------

  @Test
  fun localMode_neverNeedsSttKey() {
    assertFalse(LocalSttLogic.localModeNeedsSttKey())
  }

  // ---- cleanup gate --------------------------------------------------------

  @Test
  fun cleanupRuns_onlyWhenEnabledAndKeyPresent() {
    assertTrue(LocalSttLogic.shouldRunCleanup(enabled = true, hasCleanupKey = true))
    assertFalse(LocalSttLogic.shouldRunCleanup(enabled = true, hasCleanupKey = false))
    assertFalse(LocalSttLogic.shouldRunCleanup(enabled = false, hasCleanupKey = true))
    assertFalse(LocalSttLogic.shouldRunCleanup(enabled = false, hasCleanupKey = false))
  }

  // ---- error-code → message ------------------------------------------------

  @Test
  fun errorMessages_mapKnownCodes() {
    assertEquals("Didn't catch that", LocalSttLogic.errorMessage(LocalSttLogic.ERROR_NO_MATCH))
    assertEquals(
      "Microphone permission is required",
      LocalSttLogic.errorMessage(LocalSttLogic.ERROR_INSUFFICIENT_PERMISSIONS),
    )
    assertEquals(
      "Language pack unavailable — install it in system settings",
      LocalSttLogic.errorMessage(LocalSttLogic.ERROR_LANGUAGE_UNAVAILABLE),
    )
    assertEquals(
      "On-device recognition unavailable on this phone",
      LocalSttLogic.errorMessage(LocalSttLogic.ERROR_ENGINE_UNAVAILABLE),
    )
  }

  @Test
  fun errorCodeConstants_matchPlatformValues() {
    // Pinned to the public android.speech.SpeechRecognizer.ERROR_* ints so the
    // pure-JVM mapping stays faithful to what the platform delivers on-device.
    assertEquals(1, LocalSttLogic.ERROR_NETWORK_TIMEOUT)
    assertEquals(7, LocalSttLogic.ERROR_NO_MATCH)
    assertEquals(9, LocalSttLogic.ERROR_INSUFFICIENT_PERMISSIONS)
    assertEquals(13, LocalSttLogic.ERROR_LANGUAGE_UNAVAILABLE)
  }

  @Test
  fun errorMessage_unknownCodeIncludesTheCode() {
    val msg = LocalSttLogic.errorMessage(999)
    assertTrue("unknown-code message should surface the raw code", msg.contains("999"))
  }
}
