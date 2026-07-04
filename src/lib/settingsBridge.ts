import { Platform } from 'react-native';
import type { DictationHandoff } from '@openflow/shared';
import { encodeHandoff, decodeHandoff } from '@openflow/shared';

/**
 * settingsBridge — thin, decoupled interface to the PLATFORM-NATIVE shared
 * storage that the keyboard / IME reads.
 *
 * The companion app (this chunk, C2) owns none of the native code. The other
 * agents provide:
 *   - iOS  (C3): an App Group written via `@bacons/apple-targets`'s
 *                `ExtensionStorage` (group.computer.openflow.mobile). The
 *                keyboard extension reads settings + the dictation hand-off from
 *                there.
 *   - Android (C4): a local Expo module (JS package `settings-bridge`, registered
 *                native name `SettingsBridge`) exposing the SEMANTIC writers
 *                `syncSettings(json)` / `syncSecret(ref, value)` — the module
 *                owns the same-package SharedPreferences files/keys the IME reads.
 *
 * We reach those natives through DEFENSIVE DYNAMIC REQUIRES so this file — and
 * the whole app — stays runnable in Expo Go, on web, and under Jest even before
 * the native modules exist. When a module is absent we log once and no-op.
 *
 * Everything here is best-effort mirroring: the app's own source of truth is
 * AsyncStorage (settings/history) + expo-secure-store (secrets). The bridge is
 * only about making that data visible to the keyboard.
 */

export interface SettingsBridge {
  /** Mirror the serialized (secret-free) settings JSON to native shared storage. */
  syncSettings(json: string): Promise<void>;
  /** Mirror a single secret (by ref) so the IME can authenticate. */
  syncSecret(ref: string, value: string): Promise<void>;
  /** iOS hop: write the dictation hand-off the keyboard extension reads back. */
  writeHandoff(handoff: DictationHandoff): Promise<void>;
  /** Read a previously-written hand-off (mostly for tests / diagnostics). */
  readHandoff(rid: string): Promise<DictationHandoff | null>;
}

const APP_GROUP = 'group.computer.openflow.mobile';
const HANDOFF_KEY_PREFIX = 'openflow.handoff.';
// The keyboard extension (C3) reads BOTH a per-rid key AND this "latest" key
// (it prefers per-rid, falling back to latest). We write both on every hand-off.
const HANDOFF_LATEST_KEY = 'openflow.handoff.latest';
const SETTINGS_KEY = 'openflow.settings';
const SECRET_KEY_PREFIX = 'openflow.secret.';

let warnedMissing = false;
function warnOnce(message: string): void {
  if (!warnedMissing) {
    warnedMissing = true;
    console.warn(`[settingsBridge] ${message} Native sync is a no-op for now.`);
  }
}

/**
 * iOS App-Group store via @bacons/apple-targets `ExtensionStorage`. The store is
 * constructed with the App Group suite (`group.computer.openflow.mobile`) so the
 * keyboard extension reads the same suite the Swift side opens. Generic key/value
 * — settings, secrets, and the hand-off all live here as strings.
 */
function getIosExtensionStorage(): {
  set(key: string, value: string): void;
  get(key: string): string | null;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@bacons/apple-targets');
    const ExtensionStorage = mod?.ExtensionStorage ?? mod?.default?.ExtensionStorage;
    if (!ExtensionStorage) return null;
    // ExtensionStorage is constructed with the App Group id so it targets the
    // exact UserDefaults suite the keyboard extension reads.
    const store = new ExtensionStorage(APP_GROUP);
    return {
      set: (k, v) => store.set(k, v),
      get: (k) => (store.get ? store.get(k) : null),
    };
  } catch {
    return null;
  }
}

/**
 * Android local Expo module (registered native name `SettingsBridge`) exposing
 * the SEMANTIC writers the IME's storage reader mirrors: `syncSettings(json)`
 * writes the settings SharedPreferences, `syncSecret(ref, value)` writes the
 * EncryptedSharedPreferences keyed by the setting's `apiKeyRef`. This is NOT a
 * generic key/value store — the module owns the file names + keys (C4 contract).
 */
function getAndroidBridge(): {
  syncSettings(json: string): void;
  syncSecret(ref: string, value: string): void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core');
    const native = requireOptionalNativeModule?.('SettingsBridge') ?? null;
    if (!native) return null;
    return {
      syncSettings: (json) => native.syncSettings(json),
      syncSecret: (ref, value) => native.syncSecret(ref, value),
    };
  } catch {
    return null;
  }
}

export const settingsBridge: SettingsBridge = {
  async syncSettings(json: string): Promise<void> {
    if (Platform.OS === 'ios') {
      const ios = getIosExtensionStorage();
      if (!ios) return warnOnce('iOS App-Group storage unavailable.');
      ios.set(SETTINGS_KEY, json);
      return;
    }
    if (Platform.OS === 'android') {
      const android = getAndroidBridge();
      if (!android) return warnOnce('Android settings-bridge module unavailable.');
      android.syncSettings(json);
    }
  },

  async syncSecret(ref: string, value: string): Promise<void> {
    if (Platform.OS === 'ios') {
      const ios = getIosExtensionStorage();
      if (!ios) return warnOnce('iOS App-Group storage unavailable.');
      // iOS keys secrets by a namespaced key inside the App Group suite.
      ios.set(`${SECRET_KEY_PREFIX}${ref}`, value);
      return;
    }
    if (Platform.OS === 'android') {
      const android = getAndroidBridge();
      if (!android) return warnOnce('Android settings-bridge module unavailable.');
      // The IME reads the encrypted secret by the raw `apiKeyRef` — pass it through.
      android.syncSecret(ref, value);
    }
  },

  async writeHandoff(handoff: DictationHandoff): Promise<void> {
    // Hand-off is the iOS keyboard flow only. Android records in the IME itself
    // (no hop), so there is nothing to mirror there.
    if (Platform.OS !== 'ios') return;
    const ios = getIosExtensionStorage();
    if (!ios) return warnOnce('hand-off storage unavailable (keyboard cannot read result yet).');
    const encoded = encodeHandoff(handoff);
    // Write BOTH the per-rid key (authoritative) and the "latest" key the
    // keyboard falls back to — matching the C3 App-Group read contract.
    ios.set(`${HANDOFF_KEY_PREFIX}${handoff.rid}`, encoded);
    ios.set(HANDOFF_LATEST_KEY, encoded);
  },

  async readHandoff(rid: string): Promise<DictationHandoff | null> {
    if (Platform.OS !== 'ios') return null;
    const ios = getIosExtensionStorage();
    if (!ios) return null;
    const raw = ios.get(`${HANDOFF_KEY_PREFIX}${rid}`);
    if (!raw) return null;
    try {
      return decodeHandoff(raw);
    } catch {
      return null;
    }
  },
};
