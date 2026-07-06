package computer.openflow.mobile.ime

import org.json.JSONArray
import org.json.JSONObject

/**
 * Pure-JVM Kotlin port of the shared dictionary module
 * (`shared/src/dictionary/{engine,soundex,biasing}.ts`, itself a behavioural port
 * of the desktop `src-tauri/src/audio_toolkit/text.rs`). BEHAVIOURAL parity is the
 * contract: the same JSON dictionary produces the same corrected text on desktop,
 * the RN app, and this Android IME.
 *
 * IMPORTANT: like [OpenFlowHttp] / [LocalSttLogic], this file MUST NOT import
 * anything from `android.*`. It is compiled into the app but exercised on the
 * plain JVM by `./gradlew testDebugUnitTest` (see `DictionaryEngineTest`), so it
 * may only use `java.*` + `org.json`.
 *
 * ## Two passes (left-to-right, greedy longest-match first)
 *  1. Deterministic exact-alias replacement — threshold-independent; the replaced
 *     span is LOCKED so pass 2 can neither re-edit nor span across it.
 *  2. Fuzzy correction — normalized Levenshtein + American Soundex boost over
 *     canonical words AND aliases, 1-3-word n-grams, gated by `threshold` (0.18)
 *     and a 25% length guard. `replace_exact` entries skip this pass.
 *
 * ## Hardening (ported verbatim)
 *  - edge-trim guard: a multi-word span only wins if STRICTLY better than its
 *    drop-leading and drop-trailing sub-spans against the same target;
 *  - a fuzzy n-gram may not span internal punctuation;
 *  - punctuation prefix/suffix + input case-pattern preserved (bypassed by
 *    `case_sensitive`, which emits `word` verbatim);
 *  - unicode-safe: every character operation works on CODE POINTS, never Kotlin
 *    `Char`/UTF-16 units (so astral scalars like emoji or CJK brackets never split
 *    mid-character).
 */
object DictionaryEngine {

  /** Fuzzy acceptance threshold used by the desktop default. */
  const val DEFAULT_DICTIONARY_THRESHOLD = 0.18

  /**
   * A user dictionary entry. Mirrors `DictionaryEntry` in shared
   * (`shared/src/settings/schema.ts`) — snake_case in JSON, camelCase in Kotlin.
   */
  data class Entry(
    val word: String,
    val soundsLike: List<String> = emptyList(),
    val replaceExact: Boolean = false,
    val caseSensitive: Boolean = false,
  )

  // ---- Settings parsing ----------------------------------------------------

  /**
   * Parse the `dictionary` array from the settings-root JSON. Follows the same
   * defensive, defaulted conventions as [OpenFlowHttp.parseStt]: a missing key,
   * a non-array value, malformed JSON, or a null/blank input all yield an EMPTY
   * list (the keyboard must never crash on bad settings). Individual entries that
   * lack a non-empty `word` (the one required field, zod `.min(1)`) are skipped;
   * every other field defaults (`sounds_like` [], `replace_exact`/`case_sensitive`
   * false) exactly as the shared zod schema does.
   */
  fun parseDictionary(settingsJson: String?): List<Entry> {
    if (settingsJson.isNullOrBlank()) return emptyList()
    return try {
      val arr = JSONObject(settingsJson).optJSONArray("dictionary") ?: return emptyList()
      val out = ArrayList<Entry>()
      for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        val word = if (obj.has("word") && !obj.isNull("word")) obj.optString("word") else ""
        if (word.isEmpty()) continue
        out.add(
          Entry(
            word = word,
            soundsLike = parseStringArray(obj.optJSONArray("sounds_like")),
            replaceExact = obj.optBoolean("replace_exact", false),
            caseSensitive = obj.optBoolean("case_sensitive", false),
          ),
        )
      }
      out
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun parseStringArray(arr: JSONArray?): List<String> {
    if (arr == null) return emptyList()
    val out = ArrayList<String>(arr.length())
    for (i in 0 until arr.length()) {
      if (!arr.isNull(i)) out.add(arr.optString(i))
    }
    return out
  }

  // ---- Unicode-safe primitives ---------------------------------------------

  private fun codePoints(s: String): IntArray = s.codePoints().toArray()

  private fun cpSlice(arr: IntArray, start: Int, end: Int): String {
    val sb = StringBuilder(end - start)
    var i = start
    while (i < end) {
      sb.appendCodePoint(arr[i]); i++
    }
    return sb.toString()
  }

  private fun cpCount(s: String): Int = s.codePointCount(0, s.length)

  /** Letter or number (Unicode-aware) — mirrors `/[\p{L}\p{N}]/u`. */
  private fun isAlnum(cp: Int): Boolean = Character.isLetter(cp) || Character.isDigit(cp)

  /** A cased code point currently in its uppercase form. */
  private fun isUpperCp(cp: Int): Boolean =
    Character.toLowerCase(cp) != Character.toUpperCase(cp) && cp == Character.toUpperCase(cp)

  /** Split on Unicode whitespace, dropping empty fragments. */
  private fun splitWords(text: String): List<String> =
    text.split(WHITESPACE).filter { it.isNotEmpty() }

  private val WHITESPACE = Regex("\\s+")

  /** Trim leading/trailing non-alphanumeric code points. */
  private fun trimNonAlnum(word: String): String {
    val arr = codePoints(word)
    var start = 0
    var end = arr.size
    while (start < end && !isAlnum(arr[start])) start++
    while (end > start && !isAlnum(arr[end - 1])) end--
    return cpSlice(arr, start, end)
  }

  /** Split a word into (leading punctuation, trailing punctuation). */
  private fun extractPunctuation(word: String): Pair<String, String> {
    val arr = codePoints(word)
    var prefixEnd = 0
    for (i in arr.indices) {
      if (isAlnum(arr[i])) break
      prefixEnd = i + 1
    }
    var suffixStart = arr.size
    for (i in arr.indices.reversed()) {
      if (isAlnum(arr[i])) break
      suffixStart = i
    }
    val prefix = if (prefixEnd > 0) cpSlice(arr, 0, prefixEnd) else ""
    val suffix = if (suffixStart < arr.size) cpSlice(arr, suffixStart, arr.size) else ""
    return prefix to suffix
  }

  /** Strip edge punctuation, lowercase, concatenate with no separator. */
  private fun buildNgram(words: List<String>): String =
    words.joinToString("") { trimNonAlnum(it).lowercase() }

  private fun normalizeToken(word: String, caseSensitive: Boolean): String {
    val trimmed = trimNonAlnum(word)
    return if (caseSensitive) trimmed else trimmed.lowercase()
  }

  /** Preserve the original token's case pattern when applying a replacement. */
  private fun preserveCasePattern(original: String, replacement: String): String {
    val arr = codePoints(original)
    if (arr.isNotEmpty() && arr.all { isUpperCp(it) }) {
      return replacement.uppercase()
    }
    if (arr.isNotEmpty() && isUpperCp(arr[0])) {
      val rep = codePoints(replacement)
      if (rep.isEmpty()) return replacement
      return cpSlice(rep, 0, 1).uppercase() + cpSlice(rep, 1, rep.size)
    }
    return replacement
  }

  /** Levenshtein edit distance over code points. */
  private fun levenshtein(a: String, b: String): Int {
    val s = codePoints(a)
    val t = codePoints(b)
    val m = s.size
    val n = t.size
    if (m == 0) return n
    if (n == 0) return m
    val row = IntArray(n + 1) { it }
    for (i in 1..m) {
      var prevDiag = row[0]
      row[0] = i
      val si = s[i - 1]
      for (j in 1..n) {
        val above = row[j]
        val cost = if (si == t[j - 1]) 0 else 1
        row[j] = minOf(above + 1, row[j - 1] + 1, prevDiag + cost)
        prevDiag = above
      }
    }
    return row[n]
  }

  // ---- American Soundex (boost only) ---------------------------------------

  private fun soundexDigit(c: Char): Char = when (c) {
    'b', 'f', 'p', 'v' -> '1'
    'c', 'g', 'j', 'k', 'q', 's', 'x', 'z' -> '2'
    'd', 't' -> '3'
    'l' -> '4'
    'm', 'n' -> '5'
    'r' -> '6'
    else -> '0'
  }

  private fun soundexCode(word: String): String {
    val letters = word.lowercase().filter { it in 'a'..'z' }
    if (letters.isEmpty()) return ""
    val first = letters[0]
    val sb = StringBuilder().append(first.uppercaseChar())
    var last = soundexDigit(first)
    var i = 1
    while (i < letters.length && sb.length < 4) {
      val d = soundexDigit(letters[i])
      if (d != '0' && d != last) sb.append(d)
      last = d
      i++
    }
    return (sb.toString() + "000").substring(0, 4)
  }

  /** Whether two words share a Soundex code (empty/letterless words never match). */
  fun soundex(a: String, b: String): Boolean {
    val ca = soundexCode(a)
    val cb = soundexCode(b)
    if (ca.isEmpty() || cb.isEmpty()) return false
    return ca == cb
  }

  // ---- Precomputed matchers / targets --------------------------------------

  private class AliasMatcher(
    val tokens: List<String>,
    val canonical: String,
    val caseSensitive: Boolean,
  )

  private class FuzzyTarget(
    val compare: String,
    val canonical: String,
    val caseSensitive: Boolean,
  )

  private fun buildAliasMatchers(entries: List<Entry>): List<AliasMatcher> {
    val matchers = ArrayList<AliasMatcher>()
    for (entry in entries) {
      for (alias in entry.soundsLike) {
        val tokens = splitWords(alias)
          .map { normalizeToken(it, entry.caseSensitive) }
          .filter { it.isNotEmpty() }
        if (tokens.isEmpty()) continue
        matchers.add(AliasMatcher(tokens, entry.word, entry.caseSensitive))
      }
    }
    return matchers
  }

  private fun buildFuzzyTargets(entries: List<Entry>): List<FuzzyTarget> {
    val targets = ArrayList<FuzzyTarget>()
    for (entry in entries) {
      if (entry.replaceExact) continue
      val canonicalCmp = entry.word.lowercase().replace(" ", "")
      if (canonicalCmp.isNotEmpty()) {
        targets.add(FuzzyTarget(canonicalCmp, entry.word, entry.caseSensitive))
      }
      for (alias in entry.soundsLike) {
        val aliasCmp = alias.lowercase().replace(" ", "")
        if (aliasCmp.isNotEmpty()) {
          targets.add(FuzzyTarget(aliasCmp, entry.word, entry.caseSensitive))
        }
      }
    }
    return targets
  }

  private class AliasHit(val n: Int, val matcher: AliasMatcher)

  /** Greedy longest exact-alias match anchored at the start of `words`. */
  private fun matchExactAlias(words: List<String>, matchers: List<AliasMatcher>): AliasHit? {
    var best: AliasHit? = null
    for (matcher in matchers) {
      val n = matcher.tokens.size
      if (n > words.size) continue
      var allMatch = true
      for (k in 0 until n) {
        if (normalizeToken(words[k], matcher.caseSensitive) != matcher.tokens[k]) {
          allMatch = false
          break
        }
      }
      if (!allMatch) continue
      val current = best
      if (current == null || n > current.n) best = AliasHit(n, matcher)
    }
    return best
  }

  /** Levenshtein + Soundex score of a candidate against one target (lower = better). */
  private fun scoreAgainstTarget(candidate: String, target: FuzzyTarget): Double {
    val candLen = cpCount(candidate)
    val cmpLen = cpCount(target.compare)
    val maxLen = maxOf(candLen, cmpLen)
    if (maxLen == 0) return 1.0
    val levScore = levenshtein(candidate, target.compare).toDouble() / maxLen
    return if (soundex(candidate, target.compare)) levScore * 0.3 else levScore
  }

  private class FuzzyMatch(val target: FuzzyTarget, val score: Double)

  private fun findBestFuzzy(candidate: String, targets: List<FuzzyTarget>, threshold: Double): FuzzyMatch? {
    val candLen = cpCount(candidate)
    if (candidate.isEmpty() || candLen > 50) return null

    var best: FuzzyMatch? = null
    var bestScore = Double.MAX_VALUE

    for (target in targets) {
      val cmpLen = cpCount(target.compare)
      val lenDiff = Math.abs(candLen - cmpLen)
      val maxLen = maxOf(candLen, cmpLen)
      val maxAllowedDiff = maxOf(maxLen * 0.25, 2.0)
      if (lenDiff.toDouble() > maxAllowedDiff) continue

      val score = scoreAgainstTarget(candidate, target)
      if (score < threshold && score < bestScore) {
        best = FuzzyMatch(target, score)
        bestScore = score
      }
    }
    return best
  }

  // ---- Two-pass driver -----------------------------------------------------

  private class Stage1Token(val locked: Boolean, val text: String)

  private fun applyDictionaryInner(
    text: String,
    entries: List<Entry>,
    threshold: Double,
    fuzzyEnabled: Boolean,
  ): String {
    if (entries.isEmpty()) return text

    val aliasMatchers = buildAliasMatchers(entries)
    val words = splitWords(text)

    // Pass 1: deterministic exact-alias replacement, greedy longest-match.
    val stage1 = ArrayList<Stage1Token>()
    var i = 0
    while (i < words.size) {
      val hit = matchExactAlias(words.subList(i, words.size), aliasMatchers)
      if (hit != null) {
        val n = hit.n
        val matcher = hit.matcher
        val ngramWords = words.subList(i, i + n)
        val prefix = extractPunctuation(ngramWords[0]).first
        val suffix = extractPunctuation(ngramWords[n - 1]).second
        val corrected = if (matcher.caseSensitive) matcher.canonical
        else preserveCasePattern(ngramWords[0], matcher.canonical)
        stage1.add(Stage1Token(true, "$prefix$corrected$suffix"))
        i += n
      } else {
        stage1.add(Stage1Token(false, words[i]))
        i += 1
      }
    }

    if (!fuzzyEnabled) {
      return stage1.joinToString(" ") { it.text }
    }

    val fuzzyTargets = buildFuzzyTargets(entries)

    // Pass 2: fuzzy correction over canonical words + aliases (greedy n-grams).
    val result = ArrayList<String>()
    i = 0
    while (i < stage1.size) {
      val tok = stage1[i]
      if (tok.locked) {
        result.add(tok.text)
        i += 1
        continue
      }

      var matched = false
      var n = 3
      while (n >= 1) {
        if (i + n > stage1.size) {
          n -= 1
          continue
        }
        val span = stage1.subList(i, i + n)
        if (span.any { it.locked }) {
          n -= 1
          continue
        }
        val ngramWords = span.map { it.text }

        // A fuzzy n-gram must not span an internal punctuation boundary.
        var spansInternalPunct = false
        for (k in 0 until n) {
          val (prefix, suffix) = extractPunctuation(ngramWords[k])
          if ((k > 0 && prefix.isNotEmpty()) || (k + 1 < n && suffix.isNotEmpty())) {
            spansInternalPunct = true
            break
          }
        }
        if (spansInternalPunct) {
          n -= 1
          continue
        }

        val ngram = buildNgram(ngramWords)
        val found = findBestFuzzy(ngram, fuzzyTargets, threshold)
        if (found != null) {
          val target = found.target
          val score = found.score
          // Edge-trim guard.
          if (n > 1) {
            val dropLeading = buildNgram(ngramWords.subList(1, n))
            val dropTrailing = buildNgram(ngramWords.subList(0, n - 1))
            if (scoreAgainstTarget(dropLeading, target) <= score ||
              scoreAgainstTarget(dropTrailing, target) <= score
            ) {
              n -= 1
              continue
            }
          }

          val prefix = extractPunctuation(ngramWords[0]).first
          val suffix = extractPunctuation(ngramWords[n - 1]).second
          val corrected = if (target.caseSensitive) target.canonical
          else preserveCasePattern(ngramWords[0], target.canonical)
          result.add("$prefix$corrected$suffix")
          i += n
          matched = true
          break
        }
        n -= 1
      }

      if (!matched) {
        result.add(tok.text)
        i += 1
      }
    }

    return result.joinToString(" ")
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Full two-pass correction: deterministic exact-alias replacement then fuzzy
   * (Levenshtein + Soundex). `threshold` caps the fuzzy score (default
   * [DEFAULT_DICTIONARY_THRESHOLD]; `0.0` disables fuzzy, exact aliases still fire).
   */
  fun applyDictionary(
    text: String,
    entries: List<Entry>,
    threshold: Double = DEFAULT_DICTIONARY_THRESHOLD,
  ): String = applyDictionaryInner(text, entries, threshold, true)

  /** Deterministic exact-alias replacement only (fuzzy pass disabled). */
  fun applyDictionaryAliasesOnly(text: String, entries: List<Entry>): String =
    applyDictionaryInner(text, entries, 0.0, false)

  /** Canonical words of the dictionary (non-blank), for biasing / cleanup callers. */
  fun dictionaryWords(entries: List<Entry>): List<String> =
    entries.map { it.word }.filter { it.trim().isNotEmpty() }

  /**
   * Correct a transcript against the dictionary, choosing the pass by whether the
   * STT engine was already biased with the words: `prompted` → aliases-only (skip
   * the redundant fuzzy pass, desktop parity); otherwise full two-pass correction.
   * A no-op for an empty dictionary.
   */
  fun correctTranscript(
    text: String,
    entries: List<Entry>,
    prompted: Boolean,
    threshold: Double = DEFAULT_DICTIONARY_THRESHOLD,
  ): String {
    if (entries.isEmpty()) return text
    return if (prompted) applyDictionaryAliasesOnly(text, entries)
    else applyDictionary(text, entries, threshold)
  }

  // ---- Engine-biasing + cleanup-prompt helpers (mirror biasing.ts) ---------

  const val OPENAI_PROMPT_MAX_CHARS = 800
  const val VOCABULARY_BLOCK_MAX_CHARS = 800
  const val DEEPGRAM_KEYTERM_MAX_COUNT = 500
  const val DEEPGRAM_KEYWORDS_MAX_COUNT = 100

  /**
   * Join `words` into a ", "-separated biasing string, tail-truncated to
   * `maxChars` by dropping WHOLE words from the front. Blank words dropped.
   * Returns null for an empty/all-blank list (callers then send no biasing param).
   */
  fun buildPromptString(words: List<String>, maxChars: Int): String? {
    val filtered = words.filter { it.trim().isNotEmpty() }
    if (filtered.isEmpty()) return null

    val full = filtered.joinToString(", ")
    if (full.length <= maxChars) return full

    val kept = ArrayList<String>()
    var len = 0
    for (idx in filtered.indices.reversed()) {
      val w = filtered[idx]
      val sepLen = if (kept.isEmpty()) 0 else 2 // ", "
      val candidateLen = len + sepLen + w.length
      if (candidateLen > maxChars) break
      len = candidateLen
      kept.add(w)
    }
    if (kept.isEmpty()) return filtered[filtered.size - 1]
    kept.reverse()
    return kept.joinToString(", ")
  }

  /** Deepgram vocabulary-biasing param, chosen by model name (case-insensitive). */
  fun deepgramBiasingStyle(model: String): String {
    val m = model.trim().lowercase()
    return if (m.contains("nova-3") || m.contains("flux")) "keyterm" else "keywords"
  }

  /** Words for Deepgram `keyterm` biasing: canonical words PLUS their aliases. */
  fun deepgramKeytermWords(entries: List<Entry>): List<String> {
    val out = ArrayList<String>()
    for (entry in entries) {
      if (entry.word.trim().isNotEmpty()) out.add(entry.word)
      for (alias in entry.soundsLike) if (alias.trim().isNotEmpty()) out.add(alias)
    }
    return out
  }

  /**
   * The "Vocabulary" block appended to the cleanup system prompt (canonical words
   * only — never aliases). Returns null for an empty dictionary.
   */
  fun dictionaryVocabularyBlock(entries: List<Entry>): String? {
    val joined = buildPromptString(dictionaryWords(entries), VOCABULARY_BLOCK_MAX_CHARS) ?: return null
    return "Vocabulary — always use these exact spellings of the user's custom words: $joined"
  }
}
