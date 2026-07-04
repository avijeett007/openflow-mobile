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
  version: '0.2.0',
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
    // NSMicrophoneUsageDescription is managed by the `expo-audio` plugin below
    // (single source — keeps one owner of the key to avoid a duplicate-key
    // prebuild warning). Recording happens in the container app, not the keyboard.
  },
  android: {
    package: 'computer.openflow.mobile',
    // TODO(C4 Android agent): the withAndroidIme plugin injects the IME <service>,
    // method.xml, and RECORD_AUDIO / INTERNET permissions during prebuild.
  },
  plugins: [
    // Android IME injection (adds the IME <service>, method.xml, RECORD_AUDIO /
    // INTERNET permissions, and the settings-bridge gradle deps at prebuild).
    './plugins/withAndroidIme',
    // iOS keyboard extension (Swift) — generates the `computer.openflow.mobile.keyboard`
    // Xcode target from targets/keyboard/ at prebuild time. See targets/keyboard/README.md.
    '@bacons/apple-targets',
    // In-app recording (16 kHz mono). Wires RECORD_AUDIO (Android) and owns the
    // single NSMicrophoneUsageDescription (iOS) — see the ios comment above.
    [
      'expo-audio',
      {
        microphonePermission:
          'OpenFlow records your voice only while you are dictating, then transcribes it.',
      },
    ],
    // Keychain / Keystore-backed API-key storage (expo-secure-store).
    'expo-secure-store',
    // Local (on-device) STT — iOS SFSpeechRecognizer (on-device recognition) and
    // Android's built-in SpeechRecognizer. Owns NSSpeechRecognitionUsageDescription
    // (iOS). It also touches NSMicrophoneUsageDescription, but only via
    // `props || existing || default`, so expo-audio (above) remains the single
    // owner of the mic string — no duplicate-key conflict. Android manifest gets
    // the Google speech-service package visibility <queries> entry. No API key,
    // no network, no model download; see docs/NOTES-LOCAL-STT.md.
    [
      'expo-speech-recognition',
      {
        speechRecognitionPermission:
          'OpenFlow uses on-device speech recognition to transcribe your dictation locally, without sending audio to any server.',
        // This plugin also writes NSMicrophoneUsageDescription and wins on plugin
        // ordering, so mirror expo-audio's mic copy here to keep the honest,
        // single-sourced string (otherwise it reverts to the generic default).
        microphonePermission:
          'OpenFlow records your voice only while you are dictating, then transcribes it.',
      },
    ],
  ],
};

export default config;
