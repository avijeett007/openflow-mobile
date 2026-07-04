import ExpoModulesCore

/**
 * settings-bridge (iOS) — INTENTIONAL NO-OP STUB.
 *
 * NOT OWNED BY CHUNK C4. The iOS settings/secrets bridge (App Group UserDefaults
 * for non-secret settings + Keychain access group for API keys, read by the iOS
 * keyboard extension) is owned by chunk C3 (iOS keyboard / expo-apple-targets).
 * This stub only keeps the JS surface identical across platforms so the app can
 * call `syncSettings` / `syncSecret` unconditionally; C3 replaces these bodies
 * with the real App Group + Keychain writes.
 */
public class SettingsBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SettingsBridge")

    Function("syncSettings") { (_: String) in
      // no-op (see C3)
    }

    Function("syncSecret") { (_: String, _: String) in
      // no-op (see C3)
    }
  }
}
