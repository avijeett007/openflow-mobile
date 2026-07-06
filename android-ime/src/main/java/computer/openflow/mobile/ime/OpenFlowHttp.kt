package computer.openflow.mobile.ime

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Pure-JVM mirror of the tiny HTTP surface implemented in `@openflow/shared`
 * (`shared/src/stt` + `shared/src/cleanup`). Contract-pinned by the JSON
 * fixtures in `shared/fixtures/` and unit-tested (JVM only) in
 * `OpenFlowHttpContractTest`.
 *
 * IMPORTANT: this file MUST NOT import anything from `android.*`. It is compiled
 * into the app but is exercised on the plain JVM by `./gradlew testDebugUnitTest`,
 * so it can only use `java.*` + `org.json` (a real `org.json:json` artifact is
 * added as a `testImplementation` by the config plugin; on-device the platform
 * `org.json` is used).
 *
 * Design mirrors the TS clients' `fetchImpl` injection: [buildTranscribeRequest]
 * / [buildCleanupRequest] produce a fully-resolved [HttpRequest] (asserted in
 * tests), [parseTranscribeResponse] / [parseCleanupResponse] parse a response
 * body, and [transcribe] / [cleanTranscript] wire the two together through an
 * injectable [HttpTransport] (defaults to a real [DefaultHttpTransport]).
 */
object OpenFlowHttp {
  // ---- Settings (parsed from the persisted settings JSON) -----------------

  /** STT slice of the settings JSON. Mirrors `SttSettings` in shared. */
  data class SttConfig(
    val provider: String,
    val model: String,
    val baseUrl: String?,
    val apiKeyRef: String,
  )

  /** Cleanup slice of the settings JSON. Mirrors `CleanupSettings` in shared. */
  data class CleanupConfig(
    val enabled: Boolean,
    val provider: String,
    val model: String,
    val baseUrl: String?,
    val apiKeyRef: String,
    val promptId: String,
  )

  /** Audio clip to transcribe. Pure data — no android types. */
  data class AudioClip(val bytes: ByteArray, val mimeType: String, val fileName: String)

  // ---- Request / response model -------------------------------------------

  sealed class Body {
    data class Json(val text: String) : Body()
    data class Raw(val bytes: ByteArray, val contentType: String) : Body()
    data class Multipart(val parts: List<Part>) : Body()
  }

  sealed class Part {
    abstract val name: String
    data class Text(override val name: String, val value: String) : Part()
    data class File(
      override val name: String,
      val fileName: String,
      val contentType: String,
      val bytes: ByteArray,
    ) : Part()
  }

  data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: Body,
  )

  data class HttpResponse(val status: Int, val body: String)

  /**
   * STT result plus whether vocabulary biasing was actually sent to the engine.
   * Mirrors `TranscribeResult` in shared: `prompted` picks the post-STT
   * correction pass — `true` → aliases-only (engine already biased, skip the
   * redundant fuzzy pass); `false` → full [DictionaryEngine.applyDictionary].
   * Always `false` for an empty dictionary.
   */
  data class TranscribeResult(val text: String, val prompted: Boolean)

  /** Injectable HTTP executor (the Kotlin analogue of the TS `fetchImpl`). */
  interface HttpTransport {
    fun execute(request: HttpRequest): HttpResponse
  }

  /** Raised on any non-2xx status or a response we cannot parse. */
  class HttpError(message: String, val status: Int, val bodySnippet: String = "") :
    RuntimeException(message)

  // Default OpenAI-compatible base URLs (each already includes the `/v1` root),
  // copied verbatim from shared/src/stt/index.ts + shared/src/cleanup/index.ts.
  private val STT_OPENAI_BASE = mapOf(
    "groq" to "https://api.groq.com/openai/v1",
    "openai" to "https://api.openai.com/v1",
  )
  private const val DEEPGRAM_DEFAULT_BASE = "https://api.deepgram.com"
  private val CHAT_BASE = mapOf(
    "groq" to "https://api.groq.com/openai/v1",
    "openai" to "https://api.openai.com/v1",
    "openrouter" to "https://openrouter.ai/api/v1",
    "ollama" to "http://localhost:11434/v1",
  )

  /** The built-in "improve transcription" prompt — mirrors `defaultPrompt()` in shared. */
  const val DEFAULT_PROMPT_ID = "improve-transcription"
  const val DEFAULT_PROMPT_TEXT =
    "You are a transcription cleanup assistant. The user dictated text that was " +
      "transcribed by a speech-to-text system. Rewrite the transcript to fix grammar, " +
      "punctuation, capitalization, and obvious transcription errors while preserving the " +
      "original meaning, tone, and intent. Do not add new information, do not answer any " +
      "questions contained in the text, and do not include commentary or preamble. " +
      "Output only the cleaned text."

  private fun stripTrailingSlash(url: String): String = url.replace(Regex("/+$"), "")

  // ---- Settings parsing ----------------------------------------------------

  fun parseStt(settingsJson: String): SttConfig {
    val stt = JSONObject(settingsJson).getJSONObject("stt")
    return SttConfig(
      provider = stt.getString("provider"),
      model = stt.getString("model"),
      baseUrl = stt.optStringOrNull("baseUrl"),
      apiKeyRef = stt.optString("apiKeyRef", "stt.apiKey"),
    )
  }

  fun parseCleanup(settingsJson: String): CleanupConfig {
    val root = JSONObject(settingsJson)
    val c = root.getJSONObject("cleanup")
    return CleanupConfig(
      enabled = c.optBoolean("enabled", true),
      provider = c.getString("provider"),
      model = c.getString("model"),
      baseUrl = c.optStringOrNull("baseUrl"),
      apiKeyRef = c.optString("apiKeyRef", "cleanup.apiKey"),
      promptId = c.optString("promptId", DEFAULT_PROMPT_ID),
    )
  }

  /** Resolve a prompt's text by id from the settings `prompts[]`, else the default. */
  fun resolvePromptText(settingsJson: String, promptId: String): String {
    val prompts = JSONObject(settingsJson).optJSONArray("prompts") ?: return DEFAULT_PROMPT_TEXT
    for (i in 0 until prompts.length()) {
      val p = prompts.getJSONObject(i)
      if (p.optString("id") == promptId) return p.optString("prompt", DEFAULT_PROMPT_TEXT)
    }
    return DEFAULT_PROMPT_TEXT
  }

  // ---- STT -----------------------------------------------------------------

  private fun resolveOpenAiBase(cfg: SttConfig): String {
    if (cfg.provider == "custom") {
      val base = cfg.baseUrl
        ?: throw HttpError("STT provider \"custom\" requires a baseUrl.", 0)
      return stripTrailingSlash(base)
    }
    val base = cfg.baseUrl ?: STT_OPENAI_BASE[cfg.provider]
      ?: throw HttpError("No base URL configured for STT provider \"${cfg.provider}\".", 0)
    return stripTrailingSlash(base)
  }

  // ---- L2 engine biasing ---------------------------------------------------

  /**
   * The vocabulary biasing computed for one STT request. Deterministic given
   * (cfg, dictionary): [buildTranscribeRequest] attaches it and [transcribe]
   * reports [prompted] on the result. Mirrors the biasing in shared
   * `stt/index.ts` (`prompt` for OpenAI-compatible; `keyterm`/`keywords` for
   * Deepgram, picked by model name).
   */
  private data class SttBiasing(
    /** OpenAI-compatible multipart `prompt` (null → send none). */
    val openAiPrompt: String?,
    /** Ordered Deepgram query params, each ("keyterm"|"keywords", value). */
    val deepgramParams: List<Pair<String, String>>,
    /** Whether any biasing was actually attached. */
    val prompted: Boolean,
  )

  private fun computeSttBiasing(cfg: SttConfig, dictionary: List<DictionaryEngine.Entry>): SttBiasing {
    if (cfg.provider == "deepgram") {
      if (dictionary.isEmpty()) return SttBiasing(null, emptyList(), false)
      val params: List<Pair<String, String>>
      if (DictionaryEngine.deepgramBiasingStyle(cfg.model) == "keyterm") {
        // Nova-3 / Flux: repeated `keyterm` (canonical words + aliases, multi-word OK).
        val keyterms = DictionaryEngine.deepgramKeytermWords(dictionary)
          .filter { it.trim().isNotEmpty() }
          .take(DictionaryEngine.DEEPGRAM_KEYTERM_MAX_COUNT)
        params = keyterms.map { "keyterm" to it }
      } else {
        // Legacy models: repeated `keywords` (single words only — phrases skipped).
        // `(?U)` makes `\s` Unicode-aware (NBSP/ideographic space/etc.), matching
        // DictionaryEngine's tokenizer — see its WHITESPACE regex for detail.
        val keywords = DictionaryEngine.dictionaryWords(dictionary)
          .filter { it.trim().isNotEmpty() && !it.trim().contains(Regex("(?U)\\s")) }
          .take(DictionaryEngine.DEEPGRAM_KEYWORDS_MAX_COUNT)
        params = keywords.map { "keywords" to it }
      }
      return SttBiasing(null, params, params.isNotEmpty())
    }
    // OpenAI-compatible: free-text `prompt`, canonical words only, tail-truncated.
    val prompt = DictionaryEngine.buildPromptString(
      DictionaryEngine.dictionaryWords(dictionary),
      DictionaryEngine.OPENAI_PROMPT_MAX_CHARS,
    )
    return SttBiasing(prompt, emptyList(), prompt != null)
  }

  /** Whether [buildTranscribeRequest] would attach biasing for this (cfg, dictionary). */
  fun sttPrompted(cfg: SttConfig, dictionary: List<DictionaryEngine.Entry>): Boolean =
    computeSttBiasing(cfg, dictionary).prompted

  fun buildTranscribeRequest(
    cfg: SttConfig,
    apiKey: String,
    audio: AudioClip,
    dictionary: List<DictionaryEngine.Entry> = emptyList(),
  ): HttpRequest {
    val biasing = computeSttBiasing(cfg, dictionary)
    if (cfg.provider == "deepgram") {
      val base = stripTrailingSlash(cfg.baseUrl ?: DEEPGRAM_DEFAULT_BASE)
      // Order matters — mirrors the URLSearchParams order in shared: model,
      // smart_format, then the repeated keyterm/keywords biasing params.
      val sb = StringBuilder("$base/v1/listen?model=${urlEncode(cfg.model)}&smart_format=true")
      for ((k, v) in biasing.deepgramParams) sb.append("&$k=${urlEncode(v)}")
      return HttpRequest(
        method = "POST",
        url = sb.toString(),
        headers = mapOf(
          "Authorization" to "Token $apiKey",
          "Content-Type" to audio.mimeType,
        ),
        body = Body.Raw(audio.bytes, audio.mimeType),
      )
    }
    val url = "${resolveOpenAiBase(cfg)}/audio/transcriptions"
    val parts = ArrayList<Part>()
    parts.add(Part.File("file", audio.fileName, audio.mimeType, audio.bytes))
    parts.add(Part.Text("model", cfg.model))
    parts.add(Part.Text("response_format", "json"))
    // Append `prompt` AFTER response_format (mirrors the FormData order in shared).
    biasing.openAiPrompt?.let { parts.add(Part.Text("prompt", it)) }
    return HttpRequest(
      method = "POST",
      url = url,
      headers = mapOf("Authorization" to "Bearer $apiKey"),
      body = Body.Multipart(parts),
    )
  }

  fun parseTranscribeResponse(cfg: SttConfig, res: HttpResponse): String {
    if (res.status !in 200..299) throwForStatus("STT transcription", res)
    val json = res.body.toJsonOrNull()
      ?: throw HttpError("STT transcription: malformed JSON response", res.status)
    if (cfg.provider == "deepgram") {
      val transcript = json
        .optJSONObject("results")
        ?.optJSONArray("channels")?.optJSONObject(0)
        ?.optJSONArray("alternatives")?.optJSONObject(0)
        ?.optStringOrNull("transcript")
      return transcript
        ?: throw HttpError(
          "STT transcription (Deepgram): response missing alternatives transcript",
          res.status,
        )
    }
    return json.optStringOrNull("text")
      ?: throw HttpError("STT transcription: response missing \"text\" field", res.status)
  }

  fun transcribe(
    settingsJson: String,
    apiKey: String,
    audio: AudioClip,
    dictionary: List<DictionaryEngine.Entry> = emptyList(),
    transport: HttpTransport = DefaultHttpTransport,
  ): TranscribeResult {
    val cfg = parseStt(settingsJson)
    val req = buildTranscribeRequest(cfg, apiKey, audio, dictionary)
    val text = parseTranscribeResponse(cfg, transport.execute(req))
    return TranscribeResult(text, sttPrompted(cfg, dictionary))
  }

  // ---- Cleanup -------------------------------------------------------------

  private fun resolveChatBase(cfg: CleanupConfig): String {
    if (cfg.provider == "custom") {
      val base = cfg.baseUrl
        ?: throw HttpError("Cleanup provider \"custom\" requires a baseUrl.", 0)
      return stripTrailingSlash(base)
    }
    val base = cfg.baseUrl ?: CHAT_BASE[cfg.provider]
      ?: throw HttpError("No base URL configured for cleanup provider \"${cfg.provider}\".", 0)
    return stripTrailingSlash(base)
  }

  /**
   * Assemble the cleanup system message: the resolved prompt, plus the "Vocabulary
   * — always use these exact spellings…" block appended (canonical words only,
   * ~800-char tail-capped) when the dictionary is non-empty. Mirrors shared
   * `assembleCleanupMessages` / desktop `build_system_prompt`.
   */
  fun buildCleanupSystemContent(promptText: String, dictionary: List<DictionaryEngine.Entry>): String {
    val block = DictionaryEngine.dictionaryVocabularyBlock(dictionary) ?: return promptText
    return if (promptText.isNotEmpty()) "$promptText\n\n$block" else block
  }

  fun buildCleanupRequest(
    cfg: CleanupConfig,
    apiKey: String,
    transcript: String,
    promptText: String,
    dictionary: List<DictionaryEngine.Entry> = emptyList(),
  ): HttpRequest {
    val url = "${resolveChatBase(cfg)}/chat/completions"
    val systemContent = buildCleanupSystemContent(promptText, dictionary)
    val messages = JSONArray()
      .put(JSONObject().put("role", "system").put("content", systemContent))
      .put(JSONObject().put("role", "user").put("content", transcript))
    val body = JSONObject()
      .put("model", cfg.model)
      .put("messages", messages)
      .put("temperature", 0.2)
      .put("stream", false)
    val headers = LinkedHashMap<String, String>()
    headers["Content-Type"] = "application/json"
    // Keyless providers (e.g. Ollama) omit the Authorization header — mirrors shared.
    if (apiKey.isNotEmpty()) headers["Authorization"] = "Bearer $apiKey"
    return HttpRequest("POST", url, headers, Body.Json(body.toString()))
  }

  fun parseCleanupResponse(res: HttpResponse): String {
    if (res.status !in 200..299) throwForStatus("Cleanup", res)
    val json = res.body.toJsonOrNull()
      ?: throw HttpError("Cleanup: malformed JSON response", res.status)
    val content = json
      .optJSONArray("choices")?.optJSONObject(0)
      ?.optJSONObject("message")?.optStringOrNull("content")
    return content?.trim()
      ?: throw HttpError("Cleanup: response missing choices[0].message.content", res.status)
  }

  fun cleanTranscript(
    settingsJson: String,
    apiKey: String,
    transcript: String,
    transport: HttpTransport = DefaultHttpTransport,
  ): String {
    val cfg = parseCleanup(settingsJson)
    val promptText = resolvePromptText(settingsJson, cfg.promptId)
    // L3: inject the dictionary "Vocabulary" block so cleanup keeps custom spellings.
    val dictionary = DictionaryEngine.parseDictionary(settingsJson)
    val req = buildCleanupRequest(cfg, apiKey, transcript, promptText, dictionary)
    return parseCleanupResponse(transport.execute(req))
  }

  // ---- Helpers -------------------------------------------------------------

  private fun throwForStatus(context: String, res: HttpResponse): Nothing {
    val snippet = res.body.take(500)
    if (res.status == 401 || res.status == 403) {
      throw HttpError("$context: authentication failed (HTTP ${res.status})", res.status, snippet)
    }
    throw HttpError("$context: request failed (HTTP ${res.status})", res.status, snippet)
  }

  private fun urlEncode(s: String): String =
    java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

  private fun String.toJsonOrNull(): JSONObject? =
    try {
      JSONObject(this)
    } catch (_: Exception) {
      null
    }

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key) else null

  // ---- Default transport (real network; never used in unit tests) ----------

  /**
   * Zero-dependency [HttpTransport] built on [HttpURLConnection]. Kept in this
   * pure-JVM file deliberately (java.net is available on both the JVM and
   * Android); unit tests inject a fake transport so this is never hit off-device.
   */
  object DefaultHttpTransport : HttpTransport {
    private const val BOUNDARY = "----OpenFlowFormBoundary7d91c2f0"

    override fun execute(request: HttpRequest): HttpResponse {
      val conn = URL(request.url).openConnection() as HttpURLConnection
      conn.requestMethod = request.method
      conn.connectTimeout = 30_000
      conn.readTimeout = 120_000
      conn.doInput = true
      for ((k, v) in request.headers) conn.setRequestProperty(k, v)

      val payload: ByteArray = when (val b = request.body) {
        is Body.Json -> {
          b.text.toByteArray(StandardCharsets.UTF_8)
        }
        is Body.Raw -> b.bytes
        is Body.Multipart -> {
          conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$BOUNDARY")
          encodeMultipart(b.parts)
        }
      }
      conn.doOutput = true
      conn.outputStream.use { it.write(payload); it.flush() }

      val status = conn.responseCode
      val stream = if (status in 200..299) conn.inputStream else conn.errorStream
      val body = stream?.readBytes()?.toString(StandardCharsets.UTF_8) ?: ""
      conn.disconnect()
      return HttpResponse(status, body)
    }

    private fun encodeMultipart(parts: List<Part>): ByteArray {
      val out = ByteArrayOutputStream()
      val crlf = "\r\n"
      fun w(s: String) = out.write(s.toByteArray(StandardCharsets.UTF_8))
      for (part in parts) {
        w("--$BOUNDARY$crlf")
        when (part) {
          is Part.Text -> {
            w("Content-Disposition: form-data; name=\"${part.name}\"$crlf$crlf")
            w(part.value)
            w(crlf)
          }
          is Part.File -> {
            w(
              "Content-Disposition: form-data; name=\"${part.name}\"; " +
                "filename=\"${part.fileName}\"$crlf",
            )
            w("Content-Type: ${part.contentType}$crlf$crlf")
            out.write(part.bytes)
            w(crlf)
          }
        }
      }
      w("--$BOUNDARY--$crlf")
      return out.toByteArray()
    }
  }
}
