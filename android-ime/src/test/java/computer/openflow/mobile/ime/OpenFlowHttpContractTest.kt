package computer.openflow.mobile.ime

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM contract tests for [OpenFlowHttp], bound to the SAME fixtures that pin the
 * TypeScript clients (the JSON files under `shared/fixtures`, mirrored into this module's test
 * resources by the `withAndroidIme` config plugin). If the Kotlin HTTP mirror
 * drifts from the shared contract, these fail — the whole point of C4.
 *
 * Runs on the plain JVM via `./gradlew testDebugUnitTest` (no device, no
 * android.* touched here or in [OpenFlowHttp]).
 */
class OpenFlowHttpContractTest {
  private val apiKey = "TEST_KEY"

  private fun loadFixture(name: String): JSONObject {
    val stream = javaClass.getResourceAsStream("/fixtures/$name")
      ?: error("Missing test resource fixtures/$name")
    return JSONObject(stream.readBytes().toString(Charsets.UTF_8))
  }

  /** Build a settings JSON whose `stt`/`cleanup` slice equals the fixture's `settings`. */
  private fun settingsJsonFor(kind: String, fx: JSONObject): String =
    JSONObject().put(kind, fx.getJSONObject("settings")).toString()

  private fun authHeaderOf(req: OpenFlowHttp.HttpRequest): String? = req.headers["Authorization"]

  // ---- STT -----------------------------------------------------------------

  @Test
  fun sttOpenAiCompatible_matchesFixtures() {
    for (name in listOf("stt-groq.json", "stt-openai.json")) {
      val fx = loadFixture(name)
      val cfg = OpenFlowHttp.parseStt(settingsJsonFor("stt", fx))
      val request = fx.getJSONObject("request")
      // Use the fixture's declared audio mime/name so the file part is faithful.
      val audio = OpenFlowHttp.AudioClip(
        bytes = fx.getJSONObject("audio").getString("bytesUtf8").toByteArray(),
        mimeType = fx.getJSONObject("audio").getString("mimeType"),
        fileName = fx.getJSONObject("audio").getString("fileName"),
      )
      val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, audio)

      assertEquals("[$name] url", request.getString("url"), req.url)
      assertEquals("[$name] method", request.getString("method"), req.method)

      val expectedAuth = request.getJSONObject("headers").getString("Authorization")
        .replace("<API_KEY>", apiKey)
      assertEquals("[$name] auth", expectedAuth, authHeaderOf(req))

      // Ordered multipart field names must match exactly.
      val expectedFields = request.getJSONArray("multipartFields").let { arr ->
        (0 until arr.length()).map { arr.getString(it) }
      }
      val body = req.body as OpenFlowHttp.Body.Multipart
      assertEquals("[$name] multipart field order", expectedFields, body.parts.map { it.name })

      // Response parsing yields the expected text.
      val res = OpenFlowHttp.HttpResponse(
        fx.getJSONObject("response").getInt("status"),
        fx.getJSONObject("response").getJSONObject("body").toString(),
      )
      assertEquals("[$name] text", fx.getString("expectedText"), OpenFlowHttp.parseTranscribeResponse(cfg, res))
    }
  }

  @Test
  fun sttDeepgram_matchesFixture() {
    val fx = loadFixture("stt-deepgram.json")
    val cfg = OpenFlowHttp.parseStt(settingsJsonFor("stt", fx))
    val request = fx.getJSONObject("request")
    val audioObj = fx.getJSONObject("audio")
    val audioBytes = audioObj.getString("bytesUtf8").toByteArray()
    val audio = OpenFlowHttp.AudioClip(audioBytes, audioObj.getString("mimeType"), audioObj.getString("fileName"))
    val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, audio)

    assertEquals(request.getString("url"), req.url)
    assertEquals(request.getString("method"), req.method)
    assertEquals("Token $apiKey", authHeaderOf(req))
    assertEquals(audio.mimeType, req.headers["Content-Type"])

    val raw = req.body as OpenFlowHttp.Body.Raw
    assertTrue("deepgram body is raw audio bytes", audioBytes.contentEquals(raw.bytes))

    val res = OpenFlowHttp.HttpResponse(
      fx.getJSONObject("response").getInt("status"),
      fx.getJSONObject("response").getJSONObject("body").toString(),
    )
    assertEquals(fx.getString("expectedText"), OpenFlowHttp.parseTranscribeResponse(cfg, res))
  }

  // ---- Cleanup -------------------------------------------------------------

  @Test
  fun cleanup_matchesFixtures() {
    for (name in listOf("cleanup-groq.json", "cleanup-ollama.json")) {
      val fx = loadFixture(name)
      val cfg = OpenFlowHttp.parseCleanup(settingsJsonFor("cleanup", fx))
      val request = fx.getJSONObject("request")
      val transcript = fx.getString("transcript")
      val hasAuth = request.getJSONObject("headers").has("Authorization")
      val key = if (hasAuth) apiKey else ""

      val req = OpenFlowHttp.buildCleanupRequest(cfg, key, transcript, OpenFlowHttp.DEFAULT_PROMPT_TEXT)

      assertEquals("[$name] url", request.getString("url"), req.url)
      assertEquals("[$name] method", request.getString("method"), req.method)
      assertEquals("[$name] content-type", "application/json", req.headers["Content-Type"])
      if (hasAuth) {
        assertEquals("[$name] auth", "Bearer $apiKey", authHeaderOf(req))
      } else {
        assertNull("[$name] no auth header for keyless provider", authHeaderOf(req))
      }

      val expectedBody = request.getJSONObject("body")
      val sentBody = JSONObject((req.body as OpenFlowHttp.Body.Json).text)
      assertEquals("[$name] model", expectedBody.getString("model"), sentBody.getString("model"))
      assertEquals("[$name] temperature", 0.2, sentBody.getDouble("temperature"), 0.0)
      assertFalse("[$name] stream", sentBody.getBoolean("stream"))
      val messages = sentBody.getJSONArray("messages")
      assertEquals("[$name] messages count", 2, messages.length())
      assertEquals("[$name] system role", "system", messages.getJSONObject(0).getString("role"))
      assertEquals("[$name] user role", "user", messages.getJSONObject(1).getString("role"))
      assertEquals("[$name] user content", transcript, messages.getJSONObject(1).getString("content"))

      val res = OpenFlowHttp.HttpResponse(
        fx.getJSONObject("response").getInt("status"),
        fx.getJSONObject("response").getJSONObject("body").toString(),
      )
      assertEquals("[$name] text", fx.getString("expectedText"), OpenFlowHttp.parseCleanupResponse(res))
    }
  }

  // ---- Full pipeline through an injected fake transport --------------------

  @Test
  fun transcribeAndClean_throughFakeTransport() {
    val stt = loadFixture("stt-groq.json")
    val sttSettings = settingsJsonFor("stt", stt)
    val sttTransport = object : OpenFlowHttp.HttpTransport {
      lateinit var seen: OpenFlowHttp.HttpRequest
      override fun execute(request: OpenFlowHttp.HttpRequest): OpenFlowHttp.HttpResponse {
        seen = request
        return OpenFlowHttp.HttpResponse(200, stt.getJSONObject("response").getJSONObject("body").toString())
      }
    }
    val result = OpenFlowHttp.transcribe(
      sttSettings,
      apiKey,
      OpenFlowHttp.AudioClip("FAKE".toByteArray(), "audio/wav", "audio.wav"),
      transport = sttTransport,
    )
    assertEquals(stt.getString("expectedText"), result.text)
    // No dictionary supplied → no biasing was sent → full-correction path.
    assertFalse("no dictionary means not prompted", result.prompted)
    assertEquals(stt.getJSONObject("request").getString("url"), sttTransport.seen.url)

    val cleanup = loadFixture("cleanup-groq.json")
    val cleanupSettings = settingsJsonFor("cleanup", cleanup)
    val cleanupTransport = object : OpenFlowHttp.HttpTransport {
      override fun execute(request: OpenFlowHttp.HttpRequest): OpenFlowHttp.HttpResponse =
        OpenFlowHttp.HttpResponse(200, cleanup.getJSONObject("response").getJSONObject("body").toString())
    }
    val cleaned = OpenFlowHttp.cleanTranscript(
      cleanupSettings,
      apiKey,
      cleanup.getString("transcript"),
      cleanupTransport,
    )
    assertEquals(cleanup.getString("expectedText"), cleaned)
  }

  @Test
  fun customProvider_usesBaseUrl_andErrorsWhenMissing() {
    val settings = JSONObject().put(
      "stt",
      JSONObject()
        .put("provider", "custom")
        .put("model", "whisper-x")
        .put("baseUrl", "https://stt.example.com/v1/")
        .put("apiKeyRef", "stt.apiKey"),
    ).toString()
    val cfg = OpenFlowHttp.parseStt(settings)
    val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, OpenFlowHttp.AudioClip(ByteArray(0), "audio/wav", "a.wav"))
    // Trailing slash stripped, path appended.
    assertEquals("https://stt.example.com/v1/audio/transcriptions", req.url)

    val bad = JSONObject().put(
      "stt",
      JSONObject().put("provider", "custom").put("model", "m").put("apiKeyRef", "stt.apiKey"),
    ).toString()
    val badCfg = OpenFlowHttp.parseStt(bad)
    var threw = false
    try {
      OpenFlowHttp.buildTranscribeRequest(badCfg, apiKey, OpenFlowHttp.AudioClip(ByteArray(0), "audio/wav", "a.wav"))
    } catch (e: OpenFlowHttp.HttpError) {
      threw = true
    }
    assertTrue("custom without baseUrl must throw", threw)
  }

  @Test
  fun authError_isRaisedOn401() {
    val cfg = OpenFlowHttp.parseStt(settingsJsonFor("stt", loadFixture("stt-groq.json")))
    var status = -1
    try {
      OpenFlowHttp.parseTranscribeResponse(cfg, OpenFlowHttp.HttpResponse(401, "{\"error\":\"nope\"}"))
    } catch (e: OpenFlowHttp.HttpError) {
      status = e.status
    }
    assertEquals(401, status)
  }

  // ---- L2 engine biasing (dictionary) --------------------------------------

  private fun dict(
    word: String,
    soundsLike: List<String> = emptyList(),
  ): DictionaryEngine.Entry = DictionaryEngine.Entry(word, soundsLike)

  private fun sttCfg(provider: String, model: String): OpenFlowHttp.SttConfig =
    OpenFlowHttp.SttConfig(provider, model, null, "stt.apiKey")

  private fun multipart(req: OpenFlowHttp.HttpRequest): OpenFlowHttp.Body.Multipart =
    req.body as OpenFlowHttp.Body.Multipart

  @Test
  fun openAiCompatible_emitsPromptFieldWithCanonicalWords() {
    val cfg = sttCfg("groq", "whisper-large-v3-turbo")
    val entries = listOf(dict("ChargeBee", listOf("charge bee")), dict("Kubernetes"))
    val audio = OpenFlowHttp.AudioClip(ByteArray(0), "audio/wav", "a.wav")
    val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, audio, entries)

    val parts = multipart(req).parts
    // prompt appended AFTER response_format; canonical words only (no aliases).
    assertEquals(listOf("file", "model", "response_format", "prompt"), parts.map { it.name })
    val prompt = parts.first { it.name == "prompt" } as OpenFlowHttp.Part.Text
    assertEquals("ChargeBee, Kubernetes", prompt.value)
    assertTrue(OpenFlowHttp.sttPrompted(cfg, entries))
  }

  @Test
  fun openAiCompatible_emptyDictionary_sendsNoPrompt() {
    val cfg = sttCfg("groq", "whisper-large-v3-turbo")
    val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, OpenFlowHttp.AudioClip(ByteArray(0), "audio/wav", "a.wav"))
    assertEquals(listOf("file", "model", "response_format"), multipart(req).parts.map { it.name })
    assertFalse(OpenFlowHttp.sttPrompted(cfg, emptyList()))
  }

  @Test
  fun deepgramNova3_emitsRepeatedKeytermWithWordsAndAliases() {
    val cfg = sttCfg("deepgram", "nova-3-general")
    val entries = listOf(dict("ChargeBee", listOf("charge bee")), dict("Kubernetes", listOf("kubernetis")))
    val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, OpenFlowHttp.AudioClip(ByteArray(0), "audio/m4a", "a.m4a"), entries)
    // keyterm carries canonical words AND aliases; spaces URL-encoded.
    assertTrue(req.url.contains("keyterm=ChargeBee"))
    assertTrue(req.url.contains("keyterm=charge%20bee"))
    assertTrue(req.url.contains("keyterm=Kubernetes"))
    assertTrue(req.url.contains("keyterm=kubernetis"))
    assertFalse("legacy keywords param not used for nova-3", req.url.contains("keywords="))
    assertTrue(OpenFlowHttp.sttPrompted(cfg, entries))
  }

  @Test
  fun deepgramLegacy_emitsKeywordsSingleWordsOnly() {
    val cfg = sttCfg("deepgram", "nova-2")
    // "MacBook Pro" is a phrase → skipped for legacy `keywords` (single words only).
    val entries = listOf(dict("Kubernetes", listOf("kubernetis")), dict("MacBook Pro"))
    val req = OpenFlowHttp.buildTranscribeRequest(cfg, apiKey, OpenFlowHttp.AudioClip(ByteArray(0), "audio/m4a", "a.m4a"), entries)
    assertTrue(req.url.contains("keywords=Kubernetes"))
    assertFalse("phrase skipped for legacy keywords", req.url.contains("MacBook"))
    assertFalse("keyterm not used for legacy model", req.url.contains("keyterm="))
    assertTrue(OpenFlowHttp.sttPrompted(cfg, entries))
  }

  @Test
  fun cleanup_appendsVocabularyBlock_canonicalWordsOnly() {
    val cfg = OpenFlowHttp.parseCleanup(settingsJsonFor("cleanup", loadFixture("cleanup-groq.json")))
    val entries = listOf(dict("ChargeBee", listOf("charge bee")), dict("Kubernetes", listOf("kubernetis")))
    val req = OpenFlowHttp.buildCleanupRequest(cfg, apiKey, "the transcript", OpenFlowHttp.DEFAULT_PROMPT_TEXT, entries)
    val messages = JSONObject((req.body as OpenFlowHttp.Body.Json).text).getJSONArray("messages")
    val system = messages.getJSONObject(0).getString("content")
    assertTrue(system.startsWith(OpenFlowHttp.DEFAULT_PROMPT_TEXT))
    assertTrue(system.contains("Vocabulary — always use these exact spellings"))
    assertTrue(system.contains("ChargeBee"))
    assertTrue(system.contains("Kubernetes"))
    // Aliases never leak into the cleanup prompt.
    assertFalse(system.contains("charge bee"))
    assertFalse(system.contains("kubernetis"))
  }

  @Test
  fun cleanup_emptyDictionary_leavesPromptUnchanged() {
    val cfg = OpenFlowHttp.parseCleanup(settingsJsonFor("cleanup", loadFixture("cleanup-groq.json")))
    val req = OpenFlowHttp.buildCleanupRequest(cfg, apiKey, "t", OpenFlowHttp.DEFAULT_PROMPT_TEXT)
    val messages = JSONObject((req.body as OpenFlowHttp.Body.Json).text).getJSONArray("messages")
    assertEquals(OpenFlowHttp.DEFAULT_PROMPT_TEXT, messages.getJSONObject(0).getString("content"))
  }
}
