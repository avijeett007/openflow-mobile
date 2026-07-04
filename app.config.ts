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
    // Apple Team ID — no account yet. @bacons/apple-targets only WARNS when this
    // is missing; prebuild + a CODE_SIGNING_ALLOWED=NO simulator build still work.
    // Set APPLE_TEAM_ID once an account exists (also used to sign the keyboard target).
    appleTeamId: process.env.APPLE_TEAM_ID, // TODO: real Team ID before signed builds
    // App Group shared with the keyboard extension (computer.openflow.mobile.keyboard):
    //   group.computer.openflow.mobile — non-secret settings + dictation hand-off.
    // The Keychain access group ($(AppIdentifierPrefix)computer.openflow.mobile.shared)
    // is added by the C2 app agent alongside expo-secure-store usage.
    entitlements: {
      'com.apple.security.application-groups': ['group.computer.openflow.mobile'],
    },
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
    // iOS keyboard extension (Swift) — generates the `computer.openflow.mobile.keyboard`
    // Xcode target from targets/keyboard/ at prebuild time. See targets/keyboard/README.md.
    '@bacons/apple-targets',
  ],
};

export default config;
