package expo.modules.settingsbridge

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * settings-bridge (Android). Writes to EXACTLY the on-disk stores that the IME's
 * `SettingsBridgeStore` (computer.openflow.mobile.ime) reads. The IME service and
 * this module run in the same app package/UID, so there is no cross-app storage —
 * the app pushes config here, the keyboard reads it directly.
 *
 * STORAGE CONTRACT (must stay in lock-step with
 * `android-ime/.../SettingsBridgeStore.kt` — see docs/NOTES-C4.md):
 *   - syncSettings(json): SharedPreferences "openflow.settings", key "settings.json"
 *   - syncSecret(ref, value): EncryptedSharedPreferences "openflow.secrets", key = ref
 */
class SettingsBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SettingsBridge")

    // Persist the non-secret settings JSON (the serialized @openflow/shared Settings).
    Function("syncSettings") { json: String ->
      settingsPrefs().edit().putString(SETTINGS_KEY, json).apply()
    }

    // Persist a secret keyed by its `apiKeyRef` (e.g. "stt.apiKey"), encrypted at rest.
    Function("syncSecret") { ref: String, value: String ->
      secretsPrefs().edit().putString(ref, value).apply()
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun settingsPrefs() =
    context.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE)

  private fun secretsPrefs() =
    EncryptedSharedPreferences.create(
      context,
      SECRETS_PREFS,
      MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

  companion object {
    const val SETTINGS_PREFS = "openflow.settings"
    const val SETTINGS_KEY = "settings.json"
    const val SECRETS_PREFS = "openflow.secrets"
  }
}
