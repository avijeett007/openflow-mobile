import SettingsBridgeModule from './src/SettingsBridgeModule';

/**
 * settings-bridge — thin, typed JS surface over the native module. The app (C2)
 * calls these to push config to the platform stores the OpenFlow keyboards read:
 *   - Android: SharedPreferences "openflow.settings" + EncryptedSharedPreferences
 *     "openflow.secrets" (see modules/.../SettingsBridgeModule.kt).
 *   - iOS: no-op today; C3 wires App Group UserDefaults + Keychain access group.
 */

/** Persist the serialized (non-secret) settings JSON for the keyboard to read. */
export function syncSettings(json: string): void {
  SettingsBridgeModule.syncSettings(json);
}

/** Persist a single secret keyed by its `apiKeyRef` (e.g. "stt.apiKey"). */
export function syncSecret(ref: string, value: string): void {
  SettingsBridgeModule.syncSecret(ref, value);
}

export default SettingsBridgeModule;
