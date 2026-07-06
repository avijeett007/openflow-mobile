package computer.openflow.mobile.ime

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Reads the data written by the `settings-bridge` local Expo module. The IME
 * runs inside the SAME app package/UID as the companion app, so both simply
 * open the same on-disk stores — no App Group / cross-app plumbing needed.
 *
 * STORAGE CONTRACT (the app's settings-bridge module MUST write to exactly these
 * — see docs/NOTES-C4.md):
 *   - Non-secret settings JSON:  SharedPreferences file [SETTINGS_PREFS]
 *       key [SETTINGS_KEY] -> the serialized `@openflow/shared` Settings JSON.
 *   - Secrets:                   EncryptedSharedPreferences file [SECRETS_PREFS]
 *       key = the settings' `apiKeyRef` (e.g. "stt.apiKey") -> raw secret string.
 */
class SettingsBridgeStore(private val context: Context) {
  private val settingsPrefs: SharedPreferences by lazy {
    context.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE)
  }

  private val secretsPrefs: SharedPreferences? by lazy {
    try {
      val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
      EncryptedSharedPreferences.create(
        context,
        SECRETS_PREFS,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
    } catch (e: Exception) {
      Log.e(TAG, "Failed to open encrypted secrets store", e)
      null
    }
  }

  /** The serialized settings JSON, or null if the app has not synced yet. */
  fun getSettingsJson(): String? = settingsPrefs.getString(SETTINGS_KEY, null)

  /**
   * The user's custom-vocabulary dictionary parsed from the settings-root JSON.
   * A missing key, malformed JSON, or a not-yet-synced store all yield an empty
   * list — the keyboard must never crash on bad settings. Parsing itself is the
   * pure-JVM [DictionaryEngine.parseDictionary] (kept there, like
   * [OpenFlowHttp.parseStt], so it stays unit-testable off-device); this is just
   * the typed accessor onto the bridge store, parallel to [getSettingsJson].
   */
  fun getDictionary(): List<DictionaryEngine.Entry> =
    DictionaryEngine.parseDictionary(getSettingsJson())

  /** Resolve a secret by its `apiKeyRef`. Returns "" when absent (keyless providers). */
  fun getSecret(ref: String): String = secretsPrefs?.getString(ref, null) ?: ""

  companion object {
    private const val TAG = "OpenFlowSettings"

    /** SharedPreferences file holding the non-secret settings JSON. */
    const val SETTINGS_PREFS = "openflow.settings"

    /** Key inside [SETTINGS_PREFS] for the serialized Settings JSON string. */
    const val SETTINGS_KEY = "settings.json"

    /** EncryptedSharedPreferences file holding API keys, keyed by apiKeyRef. */
    const val SECRETS_PREFS = "openflow.secrets"
  }
}
