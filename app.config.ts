import type { ExpoConfig } from 'expo/config';

/**
 * OpenFlow Mobile — Expo app config. PRE-WIRED in chunk C1 so parallel agents
 * (C2 app, C3 iOS keyboard, C4 Android IME) do not collide on identifiers.
 *
 * Identifiers below are FINAL (store IDs are permanent) — see docs/ARCHITECTURE.md.
 */
const config: ExpoConfig = {
  name: 'OpenFlow',
  slug: 'openflow-mobile',
  scheme: 'openflow',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'computer.openflow.mobile',
    // TODO(C3 iOS agent): App Group + Keychain entitlements. The keyboard
    // extension (computer.openflow.mobile.keyboard) and the app share:
    //   group.computer.openflow.mobile   (App Group — non-secret settings + result hand-off)
    //   $(AppIdentifierPrefix)computer.openflow.mobile.shared  (Keychain access group)
    // Wire these once @bacons/apple-targets / expo-apple-targets is added, e.g.:
    // entitlements: {
    //   'com.apple.security.application-groups': ['group.computer.openflow.mobile'],
    // },
    infoPlist: {
      // Recording happens in the container app (keyboards cannot access the mic).
      NSMicrophoneUsageDescription:
        'OpenFlow records your voice only while you are dictating, then transcribes it.',
    },
  },
  android: {
    package: 'computer.openflow.mobile',
    // TODO(C4 Android agent): the withAndroidIme plugin injects the IME <service>,
    // method.xml, and RECORD_AUDIO / INTERNET permissions during prebuild.
  },
  plugins: [
    // Android IME injection (currently a no-op passthrough stub — see plugins/withAndroidIme.js).
    './plugins/withAndroidIme',
    // TODO(C3 iOS agent): add '@bacons/apple-targets' here once installed. It is
    // intentionally omitted now because it requires `expo prebuild` to validate,
    // and C1 must verify with node-only tooling (`expo config`).
  ],
};

export default config;
