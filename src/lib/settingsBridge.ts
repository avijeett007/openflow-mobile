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
 *   - Android (C4): a local Expo module named "settings-bridge" exposing the
 *                same-package storage the IME reads (settings JSON + secrets).
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
const SETTINGS_KEY = 'openflow.settings';
const SECRET_KEY_PREFIX = 'openflow.secret.';

let warnedMissing = false;
function warnOnce(message: string): void {
  if (!warnedMissing) {
    warnedMissing = true;
    console.warn(`[settingsBridge] ${message} Native sync is a no-op for now.`);
  }
}

/** Defensively resolve the iOS ExtensionStorage from @bacons/apple-targets. */
function getIosExtensionStorage(): {
  set(key: string, value: string, group: string): void;
  get(key: string, group: string): string | null;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@bacons/apple-targets');
    const ExtensionStorage = mod?.ExtensionStorage ?? mod?.default?.ExtensionStorage;
    if (!ExtensionStorage) return null;
    // ExtensionStorage is typically constructed with the app-group id.
    const store = new ExtensionStorage(APP_GROUP);
    return {
      set: (k, v) => store.set(k, v),
      get: (k) => (store.get ? store.get(k) : null),
    };
  } catch {
    return null;
  }
}

/** Defensively resolve the Android local Expo module "settings-bridge". */
function getAndroidBridge(): {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core');
    const native = requireOptionalNativeModule?.('settings-bridge') ?? null;
    if (!native) return null;
    return {
      setItem: (k, v) => native.setItem(k, v),
      getItem: (k) => (native.getItem ? native.getItem(k) : null),
    };
  } catch {
    return null;
  }
}

/** Platform-appropriate raw string store, or null when the native side is absent. */
function getNativeStore(): {
  set(key: string, value: string): void;
  get(key: string): string | null;
} | null {
  if (Platform.OS === 'ios') {
    const ios = getIosExtensionStorage();
    if (ios) return { set: (k, v) => ios.set(k, v, APP_GROUP), get: (k) => ios.get(k, APP_GROUP) };
    return null;
  }
  if (Platform.OS === 'android') {
    const android = getAndroidBridge();
    if (android) return { set: (k, v) => android.setItem(k, v), get: (k) => android.getItem(k) };
    return null;
  }
  return null;
}

export const settingsBridge: SettingsBridge = {
  async syncSettings(json: string): Promise<void> {
    const store = getNativeStore();
    if (!store) return warnOnce('shared settings storage unavailable.');
    store.set(SETTINGS_KEY, json);
  },

  async syncSecret(ref: string, value: string): Promise<void> {
    const store = getNativeStore();
    if (!store) return warnOnce('shared secret storage unavailable.');
    store.set(`${SECRET_KEY_PREFIX}${ref}`, value);
  },

  async writeHandoff(handoff: DictationHandoff): Promise<void> {
    const store = getNativeStore();
    if (!store) return warnOnce('hand-off storage unavailable (keyboard cannot read result yet).');
    store.set(`${HANDOFF_KEY_PREFIX}${handoff.rid}`, encodeHandoff(handoff));
  },

  async readHandoff(rid: string): Promise<DictationHandoff | null> {
    const store = getNativeStore();
    if (!store) return null;
    const raw = store.get(`${HANDOFF_KEY_PREFIX}${rid}`);
    if (!raw) return null;
    try {
      return decodeHandoff(raw);
    } catch {
      return null;
    }
  },
};
