package computer.openflow.mobile.ime

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * OpenFlow Android voice keyboard.
 *
 * Flow (flagship, no container-app hop — Android IMEs may record directly):
 *   tap mic → ensure RECORD_AUDIO → [WavRecorder] 16 kHz mono → tap again to stop
 *   → [OpenFlowHttp.transcribe] → optional [OpenFlowHttp.cleanTranscript] →
 *   currentInputConnection.commitText(text, 1). Status + errors shown inline.
 *
 * Settings + API keys come from [SettingsBridgeStore] (written by the app's
 * `settings-bridge` local module; same UID, so a plain read).
 */
class OpenFlowIme : InputMethodService() {
  private enum class Status { IDLE, RECORDING, TRANSCRIBING, CLEANING, ERROR }

  private val recorder = WavRecorder()
  private val mainHandler = Handler(Looper.getMainLooper())
  private lateinit var executor: ExecutorService
  private val store by lazy { SettingsBridgeStore(applicationContext) }

  private lateinit var statusText: TextView
  private lateinit var micButton: Button
  private lateinit var insertRawButton: Button

  /** Holds the last raw transcript so "Insert raw" works after a cleanup failure. */
  private var pendingRawTranscript: String? = null

  override fun onCreate() {
    super.onCreate()
    executor = Executors.newSingleThreadExecutor()
  }

  override fun onCreateInputView(): View = buildKeyboardView()

  override fun onDestroy() {
    recorder.cancel()
    executor.shutdownNow()
    super.onDestroy()
  }

  // ---- View construction ---------------------------------------------------

  private fun buildKeyboardView(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(COLOR_BG)
      setPadding(dp(12), dp(12), dp(12), dp(12))
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    }

    statusText = TextView(this).apply {
      text = getString0("Tap the mic and start speaking")
      setTextColor(COLOR_MUTED)
      textSize = 14f
      gravity = Gravity.CENTER
      setPadding(0, dp(4), 0, dp(10))
    }
    root.addView(statusText)

    micButton = Button(this).apply {
      text = MIC_LABEL_IDLE
      setTextColor(Color.WHITE)
      textSize = 18f
      background = roundedRect(COLOR_ACCENT, dp(16))
      setOnClickListener { onMicTapped() }
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(84),
      )
    }
    root.addView(micButton)

    insertRawButton = Button(this).apply {
      text = "Insert raw transcript"
      setTextColor(COLOR_ACCENT)
      textSize = 14f
      background = roundedStroke(COLOR_ACCENT, dp(12))
      visibility = View.GONE
      setOnClickListener { onInsertRawTapped() }
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(48),
      ).apply { topMargin = dp(8) }
    }
    root.addView(insertRawButton)

    root.addView(buildFallbackRow())
    return root
  }

  /** Minimal always-usable key row so the keyboard is functional without dictation. */
  private fun buildFallbackRow(): View {
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(10) }
    }
    row.addView(fallbackKey("⌫", weight = 1f) { currentInputConnection?.deleteSurroundingText(1, 0) })
    row.addView(fallbackKey("space", weight = 2f) { currentInputConnection?.commitText(" ", 1) })
    row.addView(fallbackKey("⏎", weight = 1f) { sendEnter() })
    row.addView(fallbackKey("🌐", weight = 1f) { switchKeyboard() })
    row.addView(fallbackKey("OpenFlow", weight = 2f) { openApp("settings") })
    return row
  }

  private fun fallbackKey(label: String, weight: Float, onTap: () -> Unit): Button =
    Button(this).apply {
      text = label
      setTextColor(COLOR_TEXT)
      textSize = 14f
      background = roundedRect(COLOR_SURFACE, dp(10))
      setOnClickListener { onTap() }
      layoutParams = LinearLayout.LayoutParams(0, dp(48), weight).apply {
        marginStart = dp(3)
        marginEnd = dp(3)
      }
    }

  // ---- Interactions --------------------------------------------------------

  private fun onMicTapped() {
    if (recorder.isRecording) {
      stopAndProcess()
      return
    }
    if (!hasMicPermission()) {
      setStatus(Status.ERROR, "Grant microphone access in OpenFlow, then return")
      openApp("mic-permission")
      return
    }
    try {
      recorder.start()
      hideInsertRaw()
      setStatus(Status.RECORDING, "Listening… tap to stop")
    } catch (e: Exception) {
      setStatus(Status.ERROR, "Could not start recording")
    }
  }

  private fun stopAndProcess() {
    val wav = try {
      recorder.stop()
    } catch (e: Exception) {
      setStatus(Status.ERROR, "Recording failed")
      return
    }
    if (wav.size <= WAV_HEADER_BYTES) {
      setStatus(Status.IDLE, "No audio captured — tap the mic to try again")
      return
    }
    setStatus(Status.TRANSCRIBING, "Transcribing…")
    executor.execute { runPipeline(wav) }
  }

  /** Runs on the background executor. */
  private fun runPipeline(wav: ByteArray) {
    val settingsJson = store.getSettingsJson()
    if (settingsJson.isNullOrBlank()) {
      postStatus(Status.ERROR, "Open OpenFlow to choose a provider and add your API key")
      return
    }

    val raw: String = try {
      val stt = OpenFlowHttp.parseStt(settingsJson)
      val key = store.getSecret(stt.apiKeyRef)
      OpenFlowHttp.transcribe(
        settingsJson,
        key,
        OpenFlowHttp.AudioClip(wav, AUDIO_MIME, AUDIO_FILENAME),
      )
    } catch (e: OpenFlowHttp.HttpError) {
      postStatus(Status.ERROR, "Transcription failed: ${e.message}")
      return
    } catch (e: Exception) {
      postStatus(Status.ERROR, "Transcription failed — check your connection")
      return
    }

    val cleanup = try {
      OpenFlowHttp.parseCleanup(settingsJson)
    } catch (e: Exception) {
      null
    }

    if (cleanup == null || !cleanup.enabled) {
      commitOnMain(raw)
      return
    }

    setStatusOnMain(Status.CLEANING, "Cleaning up…")
    val cleaned: String = try {
      val key = store.getSecret(cleanup.apiKeyRef)
      OpenFlowHttp.cleanTranscript(settingsJson, key, raw)
    } catch (e: Exception) {
      // Cleanup is best-effort: keep the raw transcript reachable via the button.
      pendingRawTranscript = raw
      mainHandler.post {
        setStatus(Status.ERROR, "Cleanup failed — insert the raw transcript?")
        showInsertRaw()
      }
      return
    }
    commitOnMain(cleaned)
  }

  private fun onInsertRawTapped() {
    val raw = pendingRawTranscript ?: return
    currentInputConnection?.commitText(raw, 1)
    pendingRawTranscript = null
    hideInsertRaw()
    setStatus(Status.IDLE, "Inserted raw transcript")
  }

  private fun commitOnMain(text: String) {
    mainHandler.post {
      currentInputConnection?.commitText(text, 1)
      setStatus(Status.IDLE, "Done — tap the mic to dictate again")
    }
  }

  private fun sendEnter() {
    val ic = currentInputConnection ?: return
    ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
    ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
  }

  @Suppress("DEPRECATION")
  private fun switchKeyboard() {
    val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      if (switchToPreviousInputMethod()) return
    }
    imm?.showInputMethodPicker()
  }

  private fun openApp(route: String) {
    val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      putExtra(EXTRA_ROUTE, route)
    }
    if (intent != null) startActivity(intent)
  }

  // ---- Permissions ---------------------------------------------------------

  private fun hasMicPermission(): Boolean =
    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  // ---- Status / small UI helpers ------------------------------------------

  private fun setStatus(status: Status, message: String) {
    if (!::statusText.isInitialized) return
    statusText.text = message
    statusText.setTextColor(if (status == Status.ERROR) COLOR_ERROR else COLOR_MUTED)
    micButton.text = if (status == Status.RECORDING) MIC_LABEL_RECORDING else MIC_LABEL_IDLE
    micButton.background =
      roundedRect(if (status == Status.RECORDING) COLOR_RECORDING else COLOR_ACCENT, dp(16))
  }

  private fun postStatus(status: Status, message: String) = mainHandler.post { setStatus(status, message) }
  private fun setStatusOnMain(status: Status, message: String) = mainHandler.post { setStatus(status, message) }

  private fun showInsertRaw() {
    if (::insertRawButton.isInitialized) insertRawButton.visibility = View.VISIBLE
  }

  private fun hideInsertRaw() {
    if (::insertRawButton.isInitialized) insertRawButton.visibility = View.GONE
  }

  private fun roundedRect(color: Int, radius: Int): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      setColor(color)
      cornerRadius = radius.toFloat()
    }

  private fun roundedStroke(color: Int, radius: Int): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      setColor(COLOR_SURFACE)
      cornerRadius = radius.toFloat()
      setStroke(dp(1), color)
    }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  // Avoid depending on app-owned string resources; keyboard copy lives in code.
  private fun getString0(s: String): String = s

  companion object {
    // OpenFlow brand: violet accent on a dark surface.
    private const val COLOR_ACCENT = 0xFF7C5CFF.toInt()
    private const val COLOR_RECORDING = 0xFFFF6B6B.toInt()
    private const val COLOR_BG = 0xFF121212.toInt()
    private const val COLOR_SURFACE = 0xFF1E1E1E.toInt()
    private const val COLOR_TEXT = 0xFFECECEC.toInt()
    private const val COLOR_MUTED = 0xFF9A9A9A.toInt()
    private const val COLOR_ERROR = 0xFFFF6B6B.toInt()

    private const val MIC_LABEL_IDLE = "🎤  Tap to speak"
    private const val MIC_LABEL_RECORDING = "■  Stop"

    private const val AUDIO_MIME = "audio/wav"
    private const val AUDIO_FILENAME = "audio.wav"
    private const val WAV_HEADER_BYTES = 44

    /** Deep-link hint the companion app reads to route to a screen (see NOTES-C4). */
    const val EXTRA_ROUTE = "openflow.route"
  }
}
