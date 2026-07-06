package computer.openflow.mobile.ime

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [DictionaryEngine] — the Kotlin mirror of the shared TS
 * dictionary engine. Key cases are ported VERBATIM from
 * `shared/src/dictionary/dictionary.test.ts` so BEHAVIOURAL parity is pinned
 * (same dictionary → same corrected text on desktop, RN app, and this IME). Plus
 * settings-parsing coverage for the new `dictionary` field.
 *
 * Runs on the plain JVM via `./gradlew testDebugUnitTest`; no device, no android.*.
 */
class DictionaryEngineTest {

  private fun entry(
    word: String,
    soundsLike: List<String> = emptyList(),
    replaceExact: Boolean = false,
    caseSensitive: Boolean = false,
  ): DictionaryEngine.Entry = DictionaryEngine.Entry(word, soundsLike, replaceExact, caseSensitive)

  // ---- Exact-alias pass (deterministic, threshold-independent) --------------

  @Test
  fun rewritesSingleWordAliasToCanonical() {
    val entries = listOf(entry("Kubernetes", listOf("kubernetis", "coober netties")))
    assertEquals(
      "we deploy on Kubernetes today",
      DictionaryEngine.applyDictionary("we deploy on kubernetis today", entries),
    )
  }

  @Test
  fun rewritesMultiWordAliasViaNgram() {
    val entries = listOf(entry("MySQL", listOf("my sequel")))
    assertEquals(
      "store it in MySQL please",
      DictionaryEngine.applyDictionary("store it in my sequel please", entries),
    )
  }

  @Test
  fun aliasFiresAtThresholdZero() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee")))
    assertEquals(
      "the ChargeBee invoice",
      DictionaryEngine.applyDictionary("the charge bee invoice", entries, 0.0),
    )
  }

  @Test
  fun preservesTrailingPunctuationAroundAliasReplacement() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee")))
    assertTrue(
      DictionaryEngine.applyDictionary("use charge bee, please", entries, 0.0).contains("ChargeBee,"),
    )
  }

  // ---- Fuzzy pass -----------------------------------------------------------

  @Test
  fun correctsNearMissesOfCanonicalWords() {
    val entries = listOf(entry("hello"), entry("world"))
    assertEquals("hello world", DictionaryEngine.applyDictionary("helo wrold", entries, 0.5))
  }

  @Test
  fun joinsSplitWordsIntoCanonical() {
    val entries = listOf(entry("ChargeBee"))
    assertEquals("use ChargeBee today", DictionaryEngine.applyDictionary("use Charge B today", entries))
  }

  @Test
  fun prefersLongerNgram() {
    val entries = listOf(entry("OpenAI"), entry("GPT"))
    assertEquals("OpenAI GPT model", DictionaryEngine.applyDictionary("Open AI GPT model", entries, 0.5))
  }

  @Test
  fun fuzzyHitOnAliasResolvesToCanonical() {
    val entries = listOf(entry("Kubernetes", listOf("kubernetes cluster")))
    assertTrue(DictionaryEngine.applyDictionary("our kubernetis stack", entries, 0.3).contains("Kubernetes"))
  }

  @Test
  fun replaceExactDisablesFuzzyButAliasStillFires() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee"), replaceExact = true))
    assertEquals("the chargebe invoice", DictionaryEngine.applyDictionary("the chargebe invoice", entries, 0.5))
    assertEquals("the ChargeBee invoice", DictionaryEngine.applyDictionary("the charge bee invoice", entries, 0.5))
  }

  // ---- Case handling --------------------------------------------------------

  @Test
  fun caseSensitiveEmitsWordVerbatim() {
    val entries = listOf(entry("iOS", listOf("i o s"), caseSensitive = true))
    val result = DictionaryEngine.applyDictionary("I o s is great", entries)
    assertTrue(result.contains("iOS"))
    assertFalse(result.contains("IOS"))
  }

  @Test
  fun allCapsInputYieldsAllCapsOutput() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee")))
    assertTrue(DictionaryEngine.applyDictionary("CHARGE BEE is great", entries).contains("CHARGEBEE"))
  }

  // ---- aliases-only mode ----------------------------------------------------

  @Test
  fun aliasesOnly_firesExactAliasesButNeverFuzzy() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee")))
    assertEquals(
      "the ChargeBee invoice",
      DictionaryEngine.applyDictionaryAliasesOnly("the charge bee invoice", entries),
    )
    assertEquals(
      "the chargebe invoice",
      DictionaryEngine.applyDictionaryAliasesOnly("the chargebe invoice", entries),
    )
  }

  // ---- Edge-trim guard ------------------------------------------------------

  @Test
  fun preservesFunctionWordsInFullRegressionSentence() {
    val entries = listOf(
      entry("ChargeBee", listOf("charge bee")),
      entry("Kubernetes", listOf("kubernetis")),
      entry("MacBook Pro"),
    )
    assertEquals(
      "Let's set up ChargeBee and Kubernetes on my MacBook Pro today",
      DictionaryEngine.applyDictionary(
        "Let's set up Charge B and Kubernetes on my MacBook Pro today",
        entries,
      ),
    )
  }

  @Test
  fun doesNotCollapseKubernetesOn() {
    assertEquals("Kubernetes on", DictionaryEngine.applyDictionary("Kubernetes on", listOf(entry("Kubernetes"))))
  }

  @Test
  fun keepsLeadingFunctionWord() {
    assertEquals("my MacBook Pro", DictionaryEngine.applyDictionary("my MacBook Pro", listOf(entry("MacBook Pro"))))
  }

  @Test
  fun shrinks3gramToWinning2gram() {
    assertEquals(
      "ChargeBee and something",
      DictionaryEngine.applyDictionary("Charge B and something", listOf(entry("ChargeBee"))),
    )
  }

  @Test
  fun allowsLegitimateMultiWordJoin() {
    assertEquals("use ChargeBee today", DictionaryEngine.applyDictionary("use Charge B today", listOf(entry("ChargeBee"))))
  }

  // ---- Unicode safety -------------------------------------------------------

  @Test
  fun preservesMultiByteLeadingPunctuation() {
    val entries = listOf(entry("Hola", listOf("hola")))
    assertEquals("dice ¿Hola mundo", DictionaryEngine.applyDictionary("dice ¿hola mundo", entries, 0.5))
  }

  @Test
  fun preservesCjkBracketPunctuation() {
    val entries = listOf(entry("Test", listOf("テスト"), caseSensitive = true))
    assertEquals("say 「Test」 now", DictionaryEngine.applyDictionary("say 「テスト」 now", entries))
  }

  @Test
  fun doesNotThrowOnEmojiAstralCodePoints() {
    // Must not throw / corrupt surrogate pairs.
    DictionaryEngine.applyDictionary("hi 👋 there", listOf(entry("Hi")))
  }

  // ---- No-op / helpers ------------------------------------------------------

  @Test
  fun returnsInputUnchangedForEmptyDictionary() {
    assertEquals("hello world", DictionaryEngine.applyDictionary("hello world", emptyList()))
  }

  @Test
  fun dictionaryWordsReturnsCanonicalDroppingBlank() {
    assertEquals(
      listOf("ChargeBee", "Kubernetes"),
      DictionaryEngine.dictionaryWords(listOf(entry("ChargeBee"), entry("   "), entry("Kubernetes"))),
    )
  }

  // ---- correctTranscript (prompted gate) ------------------------------------

  @Test
  fun correctTranscript_fullPassWhenNotPrompted() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee")))
    assertEquals("use ChargeBee today", DictionaryEngine.correctTranscript("use Charge B today", entries, false))
  }

  @Test
  fun correctTranscript_aliasesOnlyWhenPrompted() {
    val entries = listOf(entry("ChargeBee", listOf("charge bee")))
    assertEquals("use Charge B today", DictionaryEngine.correctTranscript("use Charge B today", entries, true))
    assertEquals("the ChargeBee invoice", DictionaryEngine.correctTranscript("the charge bee invoice", entries, true))
  }

  @Test
  fun correctTranscript_noopForEmptyDictionaryRegardlessOfPrompted() {
    assertEquals("unchanged text", DictionaryEngine.correctTranscript("unchanged text", emptyList(), false))
    assertEquals("unchanged text", DictionaryEngine.correctTranscript("unchanged text", emptyList(), true))
  }

  // ---- Soundex --------------------------------------------------------------

  @Test
  fun soundexMatchesKnownHomophones() {
    assertTrue(DictionaryEngine.soundex("robert", "rupert"))
    assertTrue(DictionaryEngine.soundex("ashcraft", "ashcroft"))
  }

  @Test
  fun soundexDoesNotMatchClearlyDifferentWords() {
    assertFalse(DictionaryEngine.soundex("hello", "zebra"))
  }

  @Test
  fun soundexFalseWhenEitherHasNoLetters() {
    assertFalse(DictionaryEngine.soundex("", "hello"))
    assertFalse(DictionaryEngine.soundex("1234", "hello"))
  }

  // ---- Biasing helpers ------------------------------------------------------

  @Test
  fun buildPromptString_nullForEmptyOrBlank() {
    assertNull(DictionaryEngine.buildPromptString(emptyList(), 800))
    assertNull(DictionaryEngine.buildPromptString(listOf("", "   "), 800))
  }

  @Test
  fun buildPromptString_joinsWithCommaDroppingBlanks() {
    assertEquals("ChargeBee, Kubernetes", DictionaryEngine.buildPromptString(listOf("ChargeBee", "", "Kubernetes"), 800))
  }

  @Test
  fun buildPromptString_truncatesByKeepingTail() {
    assertEquals("bbbb, cccc", DictionaryEngine.buildPromptString(listOf("aaaa", "bbbb", "cccc"), 10))
  }

  @Test
  fun buildPromptString_sendsSingleOversizedWord() {
    assertEquals("supercalifragilistic", DictionaryEngine.buildPromptString(listOf("supercalifragilistic"), 5))
  }

  @Test
  fun deepgramBiasingStyle_keytermForNova3AndFlux() {
    assertEquals("keyterm", DictionaryEngine.deepgramBiasingStyle("nova-3"))
    assertEquals("keyterm", DictionaryEngine.deepgramBiasingStyle("Nova-3-General"))
    assertEquals("keyterm", DictionaryEngine.deepgramBiasingStyle("flux-general-en"))
  }

  @Test
  fun deepgramBiasingStyle_keywordsForLegacy() {
    assertEquals("keywords", DictionaryEngine.deepgramBiasingStyle("nova-2"))
    assertEquals("keywords", DictionaryEngine.deepgramBiasingStyle("whisper-large"))
  }

  @Test
  fun deepgramKeytermWords_includesWordsAndAliasesDroppingBlanks() {
    assertEquals(
      listOf("ChargeBee", "charge bee", "Kubernetes", "kubernetis"),
      DictionaryEngine.deepgramKeytermWords(
        listOf(entry("ChargeBee", listOf("charge bee", "  ")), entry("Kubernetes", listOf("kubernetis"))),
      ),
    )
  }

  @Test
  fun dictionaryVocabularyBlock_nullForEmpty() {
    assertNull(DictionaryEngine.dictionaryVocabularyBlock(emptyList()))
  }

  @Test
  fun dictionaryVocabularyBlock_canonicalWordsOnly() {
    val block = DictionaryEngine.dictionaryVocabularyBlock(
      listOf(entry("ChargeBee", listOf("charge bee")), entry("Kubernetes", listOf("kubernetis"))),
    )
    assertTrue(block!!.startsWith("Vocabulary"))
    assertTrue(block.contains("ChargeBee"))
    assertTrue(block.contains("Kubernetes"))
    assertFalse(block.contains("charge bee"))
    assertFalse(block.contains("kubernetis"))
  }

  // ---- Settings parsing (new `dictionary` field) ----------------------------

  private fun settingsWithDictionary(dictionary: JSONArray?): String {
    val root = JSONObject().put("stt", JSONObject().put("mode", "remote"))
    if (dictionary != null) root.put("dictionary", dictionary)
    return root.toString()
  }

  @Test
  fun parseDictionary_missingKeyOrBadInput_yieldsEmpty() {
    assertTrue(DictionaryEngine.parseDictionary(null).isEmpty())
    assertTrue(DictionaryEngine.parseDictionary("").isEmpty())
    assertTrue(DictionaryEngine.parseDictionary("   ").isEmpty())
    assertTrue(DictionaryEngine.parseDictionary("{not valid json").isEmpty())
    assertTrue(DictionaryEngine.parseDictionary(settingsWithDictionary(null)).isEmpty())
    // Non-array `dictionary` value → empty, never a crash.
    assertTrue(DictionaryEngine.parseDictionary(JSONObject().put("dictionary", "oops").toString()).isEmpty())
  }

  @Test
  fun parseDictionary_appliesDefaults() {
    val arr = JSONArray().put(JSONObject().put("word", "ChargeBee"))
    val entries = DictionaryEngine.parseDictionary(settingsWithDictionary(arr))
    assertEquals(1, entries.size)
    val e = entries[0]
    assertEquals("ChargeBee", e.word)
    assertTrue(e.soundsLike.isEmpty())
    assertFalse(e.replaceExact)
    assertFalse(e.caseSensitive)
  }

  @Test
  fun parseDictionary_readsSnakeCaseFieldsAndSkipsWordlessEntries() {
    val arr = JSONArray()
      .put(
        JSONObject()
          .put("word", "iOS")
          .put("sounds_like", JSONArray().put("i o s").put("eye o s"))
          .put("replace_exact", true)
          .put("case_sensitive", true),
      )
      .put(JSONObject().put("sounds_like", JSONArray().put("no word here"))) // skipped
      .put(JSONObject().put("word", "")) // skipped (empty word)
      .put(JSONObject().put("word", "Kubernetes"))
    val entries = DictionaryEngine.parseDictionary(settingsWithDictionary(arr))
    assertEquals(2, entries.size)
    val ios = entries[0]
    assertEquals("iOS", ios.word)
    assertEquals(listOf("i o s", "eye o s"), ios.soundsLike)
    assertTrue(ios.replaceExact)
    assertTrue(ios.caseSensitive)
    assertEquals("Kubernetes", entries[1].word)
  }

  @Test
  fun biasingPrompted_onlyWhenApi33PlusAndWordsPresent() {
    assertTrue(LocalSttLogic.biasingPrompted(33, 2))
    assertTrue(LocalSttLogic.biasingPrompted(34, 1))
    assertFalse("below API 33 nothing is sent", LocalSttLogic.biasingPrompted(31, 2))
    assertFalse("no words → nothing sent", LocalSttLogic.biasingPrompted(34, 0))
  }
}
