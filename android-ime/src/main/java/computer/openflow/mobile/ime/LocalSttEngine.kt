package computer.openflow.mobile.ime

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * Thin wrapper around [android.speech.SpeechRecognizer] for the **local
 * (on-device) STT** mode. No WAV recording, no HTTP — the platform recognizer
 * captures the mic and returns text. No API key is needed.
 *
 * ## Availability & on-device strictness
 * [availability] prefers STRICT on-device recognition:
 *  - **API 31+ (S)** with [SpeechRecognizer.isOnDeviceRecognitionAvailable] →
 *    [Availability.ON_DEVICE]; we build the recognizer with
 *    [SpeechRecognizer.createOnDeviceSpeechRecognizer], which is guaranteed to
 *    stay on the device (no audio leaves the phone).
 *  - Otherwise, if [SpeechRecognizer.isRecognitionAvailable] →
 *    [Availability.NETWORK_FALLBACK]: the standard recognizer with
 *    `EXTRA_PREFER_OFFLINE=true`. **This is best-effort**: on pre-31 devices
 *    `EXTRA_PREFER_OFFLINE` only *asks* the engine to stay offline and there is
 *    no API to verify it; some OEM engines ignore it and use the network. The UI
 *    can surface this state so the user knows on-device isn't guaranteed.
 *  - Neither available → [Availability.UNAVAILABLE]; the UI should say on-device
 *    recognition is unavailable on this phone.
 *
 * On API 33+ `isOnDeviceRecognitionAvailable` is async; here we use the
 * synchronous return where present and simply fall back if it is false — a false
 * negative degrades to the network-preferring path, never to a crash.
 *
 * ## Lifecycle (SpeechRecognizer requirements)
 * [SpeechRecognizer] MUST be created, used, and destroyed on the **main thread**.
 * All of [start]/[stop]/[cancel] must therefore be called from the main thread;
 * the IME already drives them from main-thread UI callbacks, and the recognizer
 * delivers its [RecognitionListener] callbacks on the main thread too. [cancel]
 * (called on IME hide / finish-input / destroy) tears the recognizer down so it
 * never leaks; [start] always builds a fresh recognizer.
 *
 * Package visibility: on Android 11+ (API 30) an app must declare a `<queries>`
 * entry for `android.speech.RecognitionService` or `isRecognitionAvailable`
 * returns false — added by `plugins/withAndroidIme.js`.
 */
class LocalSttEngine(private val context: Context) {

  /** Callbacks are delivered on the main thread by [SpeechRecognizer]. */
  interface Callbacks {
    /** Recognizer is ready and listening. */
    fun onReady() {}

    /** Live in-progress hypothesis (may change); show it, do not commit it. */
    fun onPartial(text: String) {}

    /** Final recognized text (possibly empty on no-match). Terminal. */
    fun onFinal(text: String) {}

    /** Terminal error. `code` is a [SpeechRecognizer] `ERROR_*` (or
     * [LocalSttLogic.ERROR_ENGINE_UNAVAILABLE]); `message` is user-facing. */
    fun onError(code: Int, message: String) {}

    /** Optional mic level (dB) for a live UI meter. */
    fun onRms(level: Float) {}

    /** The user stopped speaking; results are being finalized. */
    fun onEndOfSpeech() {}
  }

  /** Strictness of the recognition engine available on this device. */
  enum class Availability {
    /** Guaranteed on-device (API 31+, dedicated on-device recognizer). */
    ON_DEVICE,

    /** A recognizer exists; we prefer offline but cannot guarantee it. */
    NETWORK_FALLBACK,

    /** No usable recognition engine installed. */
    UNAVAILABLE,
  }

  private var recognizer: SpeechRecognizer? = null
  private var callbacks: Callbacks? = null

  /** True between [start] and a terminal onFinal/onError (or [cancel]/[stop]). */
  var isListening: Boolean = false
    private set

  /**
   * Begin on-device recognition. MUST be called on the main thread. Any prior
   * session is cancelled first, so this is safe to call repeatedly. If no engine
   * is available the caller gets [Callbacks.onError] with
   * [LocalSttLogic.ERROR_ENGINE_UNAVAILABLE] and no session starts.
   */
  fun start(callbacks: Callbacks) {
    cancel()
    this.callbacks = callbacks

    val availability = availability(context)
    if (availability == Availability.UNAVAILABLE) {
      callbacks.onError(
        LocalSttLogic.ERROR_ENGINE_UNAVAILABLE,
        LocalSttLogic.errorMessage(LocalSttLogic.ERROR_ENGINE_UNAVAILABLE),
      )
      return
    }

    val rec = createRecognizer(availability)
    if (rec == null) {
      callbacks.onError(
        LocalSttLogic.ERROR_ENGINE_UNAVAILABLE,
        LocalSttLogic.errorMessage(LocalSttLogic.ERROR_ENGINE_UNAVAILABLE),
      )
      return
    }
    rec.setRecognitionListener(listener)
    recognizer = rec

    // On-device recognizer is inherently offline; for the fallback recognizer we
    // additionally request offline (best-effort, esp. pre-31).
    val preferOffline = availability == Availability.NETWORK_FALLBACK
    isListening = true
    try {
      rec.startListening(buildIntent(preferOffline))
    } catch (e: Exception) {
      isListening = false
      callbacks.onError(
        LocalSttLogic.ERROR_CLIENT,
        LocalSttLogic.errorMessage(LocalSttLogic.ERROR_CLIENT),
      )
      cancel()
    }
  }

  /**
   * Stop listening for an early finish. The recognizer still finalizes what it
   * heard and delivers [Callbacks.onFinal] (or [Callbacks.onError]). Main thread.
   */
  fun stop() {
    try {
      recognizer?.stopListening()
    } catch (_: Exception) {
    }
  }

  /**
   * Cancel and fully tear down the recognizer (no result delivered). Called on
   * IME hide / finish-input / destroy and before each [start]. Main thread. Never
   * leaks: destroys the platform recognizer and drops the listener.
   */
  fun cancel() {
    isListening = false
    recognizer?.let { rec ->
      try {
        rec.cancel()
      } catch (_: Exception) {
      }
      try {
        rec.destroy()
      } catch (_: Exception) {
      }
    }
    recognizer = null
    callbacks = null
  }

  private fun createRecognizer(availability: Availability): SpeechRecognizer? = try {
    if (availability == Availability.ON_DEVICE &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    ) {
      SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    } else {
      SpeechRecognizer.createSpeechRecognizer(context)
    }
  } catch (_: Exception) {
    null
  }

  private fun buildIntent(preferOffline: Boolean): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, deviceLocale().toLanguageTag())
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
      // EXTRA_PREFER_OFFLINE exists since API 23 (M). Pre-31 it's best-effort:
      // it asks the engine to stay offline but cannot guarantee or verify it.
      if (preferOffline && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }
    }

  @Suppress("DEPRECATION")
  private fun deviceLocale(): Locale {
    val config = context.resources.configuration
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      config.locales.get(0) ?: Locale.getDefault()
    } else {
      config.locale ?: Locale.getDefault()
    }
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      callbacks?.onReady()
    }

    override fun onBeginningOfSpeech() {}

    override fun onRmsChanged(rmsdB: Float) {
      callbacks?.onRms(rmsdB)
    }

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {
      callbacks?.onEndOfSpeech()
    }

    override fun onError(error: Int) {
      isListening = false
      callbacks?.onError(error, LocalSttLogic.errorMessage(error))
    }

    override fun onResults(results: Bundle?) {
      isListening = false
      callbacks?.onFinal(firstResult(results).orEmpty())
    }

    override fun onPartialResults(partialResults: Bundle?) {
      val text = firstResult(partialResults)
      if (!text.isNullOrEmpty()) callbacks?.onPartial(text)
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun firstResult(bundle: Bundle?): String? =
    bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

  companion object {
    /**
     * Detect the strictest recognition path available on this device. See the
     * class KDoc for the API-level rules and the best-effort caveat below 31.
     */
    fun availability(context: Context): Availability {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val onDevice = try {
          SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        } catch (_: Exception) {
          false
        }
        if (onDevice) return Availability.ON_DEVICE
      }
      val any = try {
        SpeechRecognizer.isRecognitionAvailable(context)
      } catch (_: Exception) {
        false
      }
      return if (any) Availability.NETWORK_FALLBACK else Availability.UNAVAILABLE
    }
  }
}
