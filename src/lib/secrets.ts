import * as SecureStore from 'expo-secure-store';
import { settingsBridge } from './settingsBridge';

/**
 * Secret storage. API keys live in the platform secure enclave (iOS Keychain /
 * Android Keystore-backed store) via expo-secure-store, keyed by the `apiKeyRef`
 * name from settings — NEVER inside the settings JSON (shared enforces this).
 *
 * NOTE (Android IME): the Android keyboard reads keys through a native bridge
 * the C4 agent provides (same-package EncryptedSharedPreferences). We can't
 * write that store directly from JS here, so every write is ALSO mirrored
 * through `settingsBridge.syncSecret` — a no-op until that native module exists.
 */

/** expo-secure-store keys must match [A-Za-z0-9._-]; refs like "stt.apiKey" pass. */
function toStoreKey(apiKeyRef: string): string {
  return apiKeyRef.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function getSecret(apiKeyRef: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(toStoreKey(apiKeyRef));
  } catch {
    return null;
  }
}

export async function setSecret(apiKeyRef: string, value: string): Promise<void> {
  const key = toStoreKey(apiKeyRef);
  if (value.length === 0) {
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
  // Mirror to the IME-readable native store (no-op until C4 wires the bridge).
  await settingsBridge.syncSecret(apiKeyRef, value);
}

/** Convenience: resolve a secret, returning '' when unset (STT/cleanup accept ''). */
export async function resolveSecret(apiKeyRef: string): Promise<string> {
  return (await getSecret(apiKeyRef)) ?? '';
}
