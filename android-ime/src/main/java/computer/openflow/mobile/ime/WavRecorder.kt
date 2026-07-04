package computer.openflow.mobile.ime

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Records 16 kHz mono 16-bit PCM via [AudioRecord] and wraps the captured
 * samples in a canonical 44-byte WAV header on stop. Tap-to-toggle friendly:
 * [start] spins up a reader thread, [stop] joins it and returns the WAV bytes.
 *
 * The produced clip is sent to STT as `audio/wav` (`audio.wav`) — the shared
 * contract is mime-agnostic, so WAV works for the OpenAI-compatible multipart
 * path and for Deepgram (Content-Type mirrors the mime).
 */
class WavRecorder {
  private var record: AudioRecord? = null
  @Volatile private var recording = false
  private var readerThread: Thread? = null
  private val pcm = ByteArrayOutputStream()

  val isRecording: Boolean get() = recording

  /**
   * Begin recording. Caller MUST have RECORD_AUDIO granted (checked by the IME
   * before invoking). Throws [IllegalStateException] if the recorder cannot init.
   */
  fun start() {
    if (recording) return
    val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
    if (minBuf <= 0) throw IllegalStateException("AudioRecord: invalid min buffer size ($minBuf)")
    val bufferSize = maxOf(minBuf, SAMPLE_RATE) // >= ~0.5s of headroom
    val rec = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      SAMPLE_RATE,
      CHANNEL,
      ENCODING,
      bufferSize,
    )
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw IllegalStateException("AudioRecord failed to initialize")
    }
    pcm.reset()
    record = rec
    recording = true
    rec.startRecording()
    readerThread = Thread {
      val buf = ByteArray(bufferSize)
      while (recording) {
        val n = rec.read(buf, 0, buf.size)
        if (n > 0) synchronized(pcm) { pcm.write(buf, 0, n) }
      }
    }.apply { name = "OpenFlowAudioReader"; start() }
  }

  /** Stop recording and return the WAV-wrapped bytes (empty if nothing captured). */
  fun stop(): ByteArray {
    if (!recording) return ByteArray(0)
    recording = false
    try {
      readerThread?.join(2_000)
    } catch (_: InterruptedException) {
    }
    readerThread = null
    record?.let {
      try {
        it.stop()
      } catch (_: IllegalStateException) {
      }
      it.release()
    }
    record = null
    val pcmBytes = synchronized(pcm) { pcm.toByteArray() }
    return wrapWav(pcmBytes)
  }

  /** Abort without producing output (e.g. on teardown). */
  fun cancel() {
    recording = false
    try {
      readerThread?.join(500)
    } catch (_: InterruptedException) {
    }
    readerThread = null
    record?.let {
      try {
        it.stop()
      } catch (_: IllegalStateException) {
      }
      it.release()
    }
    record = null
    pcm.reset()
  }

  companion object {
    const val SAMPLE_RATE = 16_000
    private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
    private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    private const val BITS_PER_SAMPLE = 16
    private const val NUM_CHANNELS = 1

    /** Prepend a 44-byte canonical PCM WAV header to raw little-endian PCM16 data. */
    fun wrapWav(pcm: ByteArray): ByteArray {
      val byteRate = SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE / 8
      val blockAlign = NUM_CHANNELS * BITS_PER_SAMPLE / 8
      val dataLen = pcm.size
      val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray(Charsets.US_ASCII))
      header.putInt(36 + dataLen) // ChunkSize
      header.put("WAVE".toByteArray(Charsets.US_ASCII))
      header.put("fmt ".toByteArray(Charsets.US_ASCII))
      header.putInt(16) // Subchunk1Size (PCM)
      header.putShort(1) // AudioFormat = PCM
      header.putShort(NUM_CHANNELS.toShort())
      header.putInt(SAMPLE_RATE)
      header.putInt(byteRate)
      header.putShort(blockAlign.toShort())
      header.putShort(BITS_PER_SAMPLE.toShort())
      header.put("data".toByteArray(Charsets.US_ASCII))
      header.putInt(dataLen)
      val out = ByteArray(44 + dataLen)
      System.arraycopy(header.array(), 0, out, 0, 44)
      System.arraycopy(pcm, 0, out, 44, dataLen)
      return out
    }
  }
}
