import {
  type Settings,
  defaultSettings,
  migrateSettings,
  serializeSettings,
} from '@openflow/shared';
import { type StorageBackend, getDefaultBackend } from './storageBackend';
import { settingsBridge } from './settingsBridge';

/**
 * Persisted settings store. Source of truth is AsyncStorage; every write is
 * ALSO mirrored (secret-free) through `settingsBridge` so the keyboard / IME
 * sees the same configuration. Parsing/serialization go through @openflow/shared
 * so the app and the Kotlin IME agree on the exact schema.
 */

export const SETTINGS_STORAGE_KEY = 'openflow.settings.v1';

/** Load persisted settings, coercing anything invalid to safe defaults. */
export async function loadSettings(
  backend: StorageBackend = getDefaultBackend(),
): Promise<Settings> {
  const raw = await backend.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw);
    // migrateSettings fills defaults + drops any leaked secrets + version-coerces.
    return migrateSettings(parsed);
  } catch {
    return defaultSettings();
  }
}

/** Persist settings (secret-free) and mirror to the native bridge. */
export async function saveSettings(
  settings: Settings,
  backend: StorageBackend = getDefaultBackend(),
): Promise<Settings> {
  const safe = serializeSettings(settings);
  const json = JSON.stringify(safe);
  await backend.setItem(SETTINGS_STORAGE_KEY, json);
  await settingsBridge.syncSettings(json);
  return safe;
}
