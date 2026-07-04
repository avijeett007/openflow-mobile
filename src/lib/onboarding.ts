import { type StorageBackend, getDefaultBackend } from './storageBackend';

/** Tracks whether the user finished (or skipped) the onboarding flow. */
export const ONBOARDED_KEY = 'openflow.onboarded.v1';

export async function isOnboarded(backend: StorageBackend = getDefaultBackend()): Promise<boolean> {
  return (await backend.getItem(ONBOARDED_KEY)) === 'true';
}

export async function setOnboarded(
  value: boolean,
  backend: StorageBackend = getDefaultBackend(),
): Promise<void> {
  await backend.setItem(ONBOARDED_KEY, value ? 'true' : 'false');
}
