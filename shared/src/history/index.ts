import type { PrivacyMode } from '../settings/schema';

/** A single dictation entry stored in on-device history. */
export interface HistoryRecord {
  id: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Optional app/context the dictation happened in (bundle id, url, ...). */
  appContext?: string;
  /** Raw STT transcript (may be redacted by privacy mode). */
  rawText?: string;
  /** Cleaned transcript (may be redacted by privacy mode). */
  cleanedText?: string;
  wordCount: number;
  durationMs: number;
  sttProvider: string;
  cleanupProvider?: string;
  privacyMode: PrivacyMode;
}

/**
 * Apply a privacy mode to a record, returning a redacted copy. See
 * {@link PrivacyMode} for semantics. Metadata (word count, timing, providers)
 * is always preserved so analytics keep working.
 */
export function applyPrivacy(record: HistoryRecord, mode: PrivacyMode): HistoryRecord {
  switch (mode) {
    case 'full':
      return { ...record, privacyMode: 'full' };
    case 'keywordsOnly':
      return {
        ...record,
        rawText: undefined,
        cleanedText: undefined,
        privacyMode: 'keywordsOnly',
      };
    case 'off':
      return {
        ...record,
        rawText: undefined,
        cleanedText: undefined,
        appContext: undefined,
        privacyMode: 'off',
      };
    default: {
      // Exhaustiveness guard.
      const _never: never = mode;
      return _never;
    }
  }
}

// ---- Analytics ------------------------------------------------------------

/** Typing baseline (words per minute) used to estimate time saved by speaking. */
export const TYPING_WPM = 40;

export interface Analytics {
  totalWords: number;
  dictationCount: number;
  avgWordsPerDictation: number;
  /**
   * Estimated seconds saved versus typing the same words at {@link TYPING_WPM},
   * net of the time actually spent speaking. Clamped at >= 0.
   */
  estimatedSecondsSaved: number;
  sttProviderCounts: Record<string, number>;
  cleanupProviderCounts: Record<string, number>;
}

/** Reduce a set of history records to aggregate analytics. */
export function computeAnalytics(records: HistoryRecord[]): Analytics {
  const dictationCount = records.length;
  let totalWords = 0;
  let totalDurationMs = 0;
  const sttProviderCounts: Record<string, number> = {};
  const cleanupProviderCounts: Record<string, number> = {};

  for (const r of records) {
    totalWords += r.wordCount;
    totalDurationMs += r.durationMs;
    sttProviderCounts[r.sttProvider] = (sttProviderCounts[r.sttProvider] ?? 0) + 1;
    if (r.cleanupProvider) {
      cleanupProviderCounts[r.cleanupProvider] =
        (cleanupProviderCounts[r.cleanupProvider] ?? 0) + 1;
    }
  }

  const typingSeconds = (totalWords / TYPING_WPM) * 60;
  const speakingSeconds = totalDurationMs / 1000;
  const estimatedSecondsSaved = Math.max(0, typingSeconds - speakingSeconds);

  return {
    totalWords,
    dictationCount,
    avgWordsPerDictation: dictationCount === 0 ? 0 : totalWords / dictationCount,
    estimatedSecondsSaved,
    sttProviderCounts,
    cleanupProviderCounts,
  };
}

/** Count the words in a transcript (whitespace-delimited). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
