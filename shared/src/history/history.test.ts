import {
  applyPrivacy,
  computeAnalytics,
  countWords,
  TYPING_WPM,
  type HistoryRecord,
} from './index';

function record(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'r1',
    ts: 1_700_000_000_000,
    appContext: 'com.example.app',
    rawText: 'raw dictation text',
    cleanedText: 'Raw dictation text.',
    wordCount: 3,
    durationMs: 2000,
    sttProvider: 'groq',
    cleanupProvider: 'groq',
    privacyMode: 'full',
    ...overrides,
  };
}

describe('applyPrivacy', () => {
  it('full keeps everything', () => {
    const r = record();
    expect(applyPrivacy(r, 'full')).toEqual({ ...r, privacyMode: 'full' });
  });

  it('keywordsOnly nulls text but keeps metadata and appContext', () => {
    const r = applyPrivacy(record(), 'keywordsOnly');
    expect(r.rawText).toBeUndefined();
    expect(r.cleanedText).toBeUndefined();
    expect(r.appContext).toBe('com.example.app');
    expect(r.wordCount).toBe(3);
    expect(r.privacyMode).toBe('keywordsOnly');
  });

  it('off nulls text and appContext but keeps counts/timing', () => {
    const r = applyPrivacy(record(), 'off');
    expect(r.rawText).toBeUndefined();
    expect(r.cleanedText).toBeUndefined();
    expect(r.appContext).toBeUndefined();
    expect(r.wordCount).toBe(3);
    expect(r.durationMs).toBe(2000);
    expect(r.privacyMode).toBe('off');
  });
});

describe('computeAnalytics', () => {
  it('returns zeros for empty input', () => {
    expect(computeAnalytics([])).toEqual({
      totalWords: 0,
      dictationCount: 0,
      avgWordsPerDictation: 0,
      estimatedSecondsSaved: 0,
      sttProviderCounts: {},
      cleanupProviderCounts: {},
    });
  });

  it('aggregates totals, averages, provider counts and time saved', () => {
    const records: HistoryRecord[] = [
      record({ id: 'a', wordCount: 40, durationMs: 10_000, sttProvider: 'groq', cleanupProvider: 'groq' }),
      record({ id: 'b', wordCount: 20, durationMs: 5_000, sttProvider: 'openai', cleanupProvider: undefined }),
    ];
    const a = computeAnalytics(records);
    expect(a.totalWords).toBe(60);
    expect(a.dictationCount).toBe(2);
    expect(a.avgWordsPerDictation).toBe(30);
    expect(a.sttProviderCounts).toEqual({ groq: 1, openai: 1 });
    expect(a.cleanupProviderCounts).toEqual({ groq: 1 });
    // typing 60 words @ 40wpm = 90s; spoken 15s => 75s saved.
    const typingSeconds = (60 / TYPING_WPM) * 60;
    expect(a.estimatedSecondsSaved).toBe(typingSeconds - 15);
  });

  it('clamps time saved at zero when speaking is slower than typing', () => {
    const a = computeAnalytics([record({ wordCount: 1, durationMs: 60_000 })]);
    expect(a.estimatedSecondsSaved).toBe(0);
  });
});

describe('countWords', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('  hello   world ')).toBe(2);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});
