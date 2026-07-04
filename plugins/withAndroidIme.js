/**
 * Expo config plugin: withAndroidIme (STUB).
 *
 * TODO(C4 Android agent): implement the Android IME injection. This plugin must,
 * during `expo prebuild -p android`:
 *   - add `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
 *     and `INTERNET` to AndroidManifest.xml
 *   - register the InputMethodService `<service>` with the
 *     `android.view.InputMethod` intent-filter + `android.view.im` meta-data
 *   - copy `method.xml` into res/xml
 *   - copy the Kotlin IME sources from `android-ime/` into the generated project
 *
 * For chunk C1 this is a pure PASSTHROUGH so `expo config` / prebuild stay valid
 * and later agents have a stable plugin entry to extend (no collisions).
 *
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
function withAndroidIme(config) {
  // No-op for now. Return the config unchanged.
  return config;
}

module.exports = withAndroidIme;
module.exports.default = withAndroidIme;
