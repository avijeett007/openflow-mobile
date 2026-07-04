package expo.modules.translator

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * modules/translator (Android). Wraps ML Kit on-device translation
 * (`com.google.mlkit:translate`) + language identification
 * (`com.google.mlkit:language-id`) behind the frozen JS surface
 * (DESIGN-mobile-translator.md). Gradle deps are declared in this module's own
 * build.gradle and reach the app purely via autolinking.
 *
 * Contract highlights (see docs/NOTES-T2.md):
 *  - translate() NEVER implicitly downloads. If a pack is missing it fails fast
 *    (ML Kit's translate() does not hit the network), so no silent data use.
 *  - downloadPack() is the ONLY path that downloads, gated by DownloadConditions
 *    (Wi-Fi-only by default).
 *  - One Translator client is cached per (from,to) pair and closed on destroy.
 *  - sttOnDeviceLocales() returns null — the app enumerates STT locales via
 *    expo-speech-recognition (Android SpeechRecognizer.getSupportedLocales()).
 *
 * De-Googled devices without Google Play services cannot download ML Kit models;
 * the UI surfaces that caveat and the required "Translations powered by Google".
 */
class TranslatorModule : Module() {
  // One Translator per "from|to" pair, reused across calls, closed on destroy.
  private val clients = mutableMapOf<String, Translator>()
  private val modelManager by lazy { RemoteModelManager.getInstance() }

  override fun definition() = ModuleDefinition {
    Name("Translator")

    // Translate `text` from → to. Does NOT download: if the pack is missing the
    // underlying task fails and we reject (mapped by the JS error normalizer).
    AsyncFunction("translate") { text: String, from: String, to: String, promise: Promise ->
      val translator = translatorFor(from, to)
      if (translator == null) {
        promise.reject(
          "ERR_UNSUPPORTED_PAIR",
          "Unsupported language pair: $from → $to.",
          null,
        )
        return@AsyncFunction
      }
      translator.translate(text)
        .addOnSuccessListener { promise.resolve(mapOf("text" to it)) }
        .addOnFailureListener {
          // Most commonly: model not downloaded (translate() won't fetch it).
          promise.reject("ERR_TRANSLATE", it.message ?: "Translation failed.", it)
        }
    }

    // installed | downloadable | unsupported for the (from,to) direction.
    AsyncFunction("getPairStatus") { from: String, to: String, promise: Promise ->
      val fromCode = TranslateLanguage.fromLanguageTag(from)
      val toCode = TranslateLanguage.fromLanguageTag(to)
      if (fromCode == null || toCode == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models ->
          val downloaded = models.map { it.language }.toSet()
          val installed = downloaded.contains(fromCode) && downloaded.contains(toCode)
          promise.resolve(if (installed) "installed" else "downloadable")
        }
        .addOnFailureListener {
          promise.reject("ERR_PAIR_STATUS", it.message ?: "Could not read model status.", it)
        }
    }

    // The ONLY download path. wifiOnly (default applied in JS) → DownloadConditions.
    AsyncFunction("downloadPack") { from: String, to: String, wifiOnly: Boolean, promise: Promise ->
      val translator = translatorFor(from, to)
      if (translator == null) {
        promise.reject(
          "ERR_UNSUPPORTED_PAIR",
          "Unsupported language pair: $from → $to.",
          null,
        )
        return@AsyncFunction
      }
      val conditionsBuilder = DownloadConditions.Builder()
      if (wifiOnly) conditionsBuilder.requireWifi()
      translator.downloadModelIfNeeded(conditionsBuilder.build())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener {
          promise.reject("ERR_DOWNLOAD", it.message ?: "Model download failed.", it)
        }
    }

    // All BCP-47 language tags ML Kit can translate (59 langs, English-pivot).
    AsyncFunction("listSupportedLanguages") {
      TranslateLanguage.getAllLanguages()
    }

    // Languages whose model is currently downloaded on-device.
    AsyncFunction("listDownloadedLanguages") { promise: Promise ->
      modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models -> promise.resolve(models.map { it.language }) }
        .addOnFailureListener {
          promise.reject("ERR_LIST_DOWNLOADED", it.message ?: "Could not list models.", it)
        }
    }

    // Delete a single language model. Returns true on success, false if the tag
    // is not a supported ML Kit language.
    AsyncFunction("deletePack") { lang: String, promise: Promise ->
      val code = TranslateLanguage.fromLanguageTag(lang)
      if (code == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val model = TranslateRemoteModel.Builder(code).build()
      modelManager.deleteDownloadedModel(model)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener {
          promise.reject("ERR_DELETE", it.message ?: "Could not delete model.", it)
        }
    }

    // BCP-47 code of the dominant language, or null when undetermined ("und").
    AsyncFunction("identifyLanguage") { text: String, promise: Promise ->
      LanguageIdentification.getClient().identifyLanguage(text)
        .addOnSuccessListener { code ->
          promise.resolve(if (code == "und") null else code)
        }
        .addOnFailureListener {
          promise.reject("ERR_IDENTIFY", it.message ?: "Language identification failed.", it)
        }
    }

    // Android STT-locale enumeration lives in JS (expo-speech-recognition).
    AsyncFunction("sttOnDeviceLocales") {
      null as List<String>?
    }

    // ML Kit translation is available on any device with Google Play services.
    // The de-Googled caveat + "powered by Google" attribution are handled in UI.
    AsyncFunction("isTranslationAvailable") {
      mapOf("available" to true)
    }

    // Release all cached Translator clients (each holds native resources).
    OnDestroy {
      clients.values.forEach { it.close() }
      clients.clear()
    }
  }

  /**
   * A cached Translator for the (from,to) pair, or null if either tag is not a
   * supported ML Kit language. Never triggers a download by itself.
   */
  private fun translatorFor(from: String, to: String): Translator? {
    val fromCode = TranslateLanguage.fromLanguageTag(from) ?: return null
    val toCode = TranslateLanguage.fromLanguageTag(to) ?: return null
    val key = "$fromCode|$toCode"
    return clients.getOrPut(key) {
      val options = TranslatorOptions.Builder()
        .setSourceLanguage(fromCode)
        .setTargetLanguage(toCode)
        .build()
      Translation.getClient(options)
    }
  }
}
