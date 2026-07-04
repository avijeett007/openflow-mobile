import type { HistoryRecord } from '@openflow/shared';
import { type StorageBackend, getDefaultBackend } from './storageBackend';

/**
 * On-device dictation history. Stays on the device (never mirrored to the
 * bridge). Records are stored already-redacted per the active privacy mode
 * (callers apply `applyPrivacy` from @openflow/shared before saving).
 *
 * `AppHistoryRecord` adds one app-local flag on top of the shared record:
 * `cleanupFailed` marks rows written raw-only because cleanup was enabled but
 * errored (the "insert raw with a flag" case). It is structurally a
 * `HistoryRecord`, so it flows straight into `computeAnalytics`.
 */
export type AppHistoryRecord = HistoryRecord & { cleanupFailed?: boolean };

export const HISTORY_STORAGE_KEY = 'openflow.history.v1';
const MAX_RECORDS = 500;

export async function loadHistory(
  backend: StorageBackend = getDefaultBackend(),
): Promise<AppHistoryRecord[]> {
  const raw = await backend.getItem(HISTORY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

/** Prepend a record (most-recent first), capped at MAX_RECORDS. Returns the new list. */
export async function addHistoryRecord(
  record: AppHistoryRecord,
  backend: StorageBackend = getDefaultBackend(),
): Promise<AppHistoryRecord[]> {
  const current = await loadHistory(backend);
  const next = [record, ...current].slice(0, MAX_RECORDS);
  await backend.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function clearHistory(backend: StorageBackend = getDefaultBackend()): Promise<void> {
  await backend.removeItem(HISTORY_STORAGE_KEY);
}
