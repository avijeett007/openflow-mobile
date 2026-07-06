import { type DictionaryEntry } from '@openflow/shared';
import {
  addDictionaryEntry,
  exportDictionaryJson,
  isDuplicateWord,
  mergeDictionaries,
  normalizeWordKey,
  parseAliasInput,
  parseImportedDictionary,
  removeDictionaryEntry,
  updateDictionaryEntry,
} from './dictionaryEditor';

function entry(word: string, over: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return { word, sounds_like: [], replace_exact: false, case_sensitive: false, ...over };
}

describe('normalizeWordKey', () => {
  it('trims and lowercases', () => {
    expect(normalizeWordKey('  MacBook Pro  ')).toBe('macbook pro');
  });
});

describe('parseAliasInput', () => {
  it('splits on commas, trims, and drops blanks', () => {
    expect(parseAliasInput('mac book pro, macbook,  , mackbook')).toEqual([
      'mac book pro',
      'macbook',
      'mackbook',
    ]);
  });

  it('returns an empty array for blank input', () => {
    expect(parseAliasInput('   ')).toEqual([]);
  });
});

describe('isDuplicateWord', () => {
  const entries = [entry('ChargeBee'), entry('Kubernetes')];

  it('is case-insensitive', () => {
    expect(isDuplicateWord(entries, 'chargebee')).toBe(true);
    expect(isDuplicateWord(entries, 'CHARGEBEE')).toBe(true);
  });

  it('is false for a new word', () => {
    expect(isDuplicateWord(entries, 'MySQL')).toBe(false);
  });

  it('excludes the given index (editing in place)', () => {
    expect(isDuplicateWord(entries, 'ChargeBee', 0)).toBe(false);
  });
});

describe('addDictionaryEntry', () => {
  it('adds a trimmed word with trimmed aliases', () => {
    const { entries, error } = addDictionaryEntry([], {
      word: '  MacBook Pro  ',
      aliases: [' mac book pro ', 'macbook', ''],
    });
    expect(error).toBeUndefined();
    expect(entries).toEqual([entry('MacBook Pro', { sounds_like: ['mac book pro', 'macbook'] })]);
  });

  it('blocks an empty word (after trim)', () => {
    const { entries, error } = addDictionaryEntry([entry('Kubernetes')], {
      word: '   ',
      aliases: [],
    });
    expect(error).toBe('empty-word');
    expect(entries).toEqual([entry('Kubernetes')]); // unchanged
  });

  it('blocks a case-insensitive duplicate word', () => {
    const existing = [entry('ChargeBee')];
    const { entries, error } = addDictionaryEntry(existing, {
      word: 'chargebee',
      aliases: [],
    });
    expect(error).toBe('duplicate-word');
    expect(entries).toBe(existing); // unchanged, same reference
  });

  it('applies replace_exact / case_sensitive flags when given', () => {
    const { entries } = addDictionaryEntry([], {
      word: 'ACME',
      aliases: [],
      replace_exact: true,
      case_sensitive: true,
    });
    expect(entries[0]).toEqual(entry('ACME', { replace_exact: true, case_sensitive: true }));
  });
});

describe('removeDictionaryEntry / updateDictionaryEntry', () => {
  const entries = [entry('One'), entry('Two'), entry('Three')];

  it('removes by index', () => {
    expect(removeDictionaryEntry(entries, 1)).toEqual([entry('One'), entry('Three')]);
  });

  it('patches by index without touching others', () => {
    const next = updateDictionaryEntry(entries, 1, { case_sensitive: true });
    expect(next[1]).toEqual(entry('Two', { case_sensitive: true }));
    expect(next[0]).toBe(entries[0]);
  });
});

describe('parseImportedDictionary', () => {
  it('parses a JSON array of full DictionaryEntry objects', () => {
    const payload = JSON.stringify([
      {
        word: 'ChargeBee',
        sounds_like: ['charge bee'],
        replace_exact: false,
        case_sensitive: false,
      },
    ]);
    const { entries, skipped } = parseImportedDictionary(payload);
    expect(skipped).toBe(0);
    expect(entries).toEqual([entry('ChargeBee', { sounds_like: ['charge bee'] })]);
  });

  it('parses a { dictionary: [...] } wrapper', () => {
    const payload = JSON.stringify({ dictionary: [{ word: 'Kubernetes' }] });
    const { entries } = parseImportedDictionary(payload);
    expect(entries).toEqual([entry('Kubernetes')]);
  });

  it('parses a JSON array of plain strings as word-only entries', () => {
    const payload = JSON.stringify(['MySQL', 'ChargeBee']);
    const { entries } = parseImportedDictionary(payload);
    expect(entries).toEqual([entry('MySQL'), entry('ChargeBee')]);
  });

  it('parses a plain newline/comma-separated word list', () => {
    const { entries, skipped } = parseImportedDictionary('MySQL, ChargeBee\nKubernetes\n\n');
    expect(skipped).toBe(0);
    expect(entries).toEqual([entry('MySQL'), entry('ChargeBee'), entry('Kubernetes')]);
  });

  it('counts malformed array items as skipped instead of failing the import', () => {
    const payload = JSON.stringify([{ word: 'Good' }, { word: '' }, { notAWord: 1 }]);
    const { entries, skipped } = parseImportedDictionary(payload);
    expect(entries).toEqual([entry('Good')]);
    expect(skipped).toBe(2);
  });

  it('returns empty for blank input', () => {
    expect(parseImportedDictionary('   ')).toEqual({ entries: [], skipped: 0 });
  });

  it('falls back to word-list parsing for a JSON-shaped but unrecognized object', () => {
    // Not an array and no `dictionary` key — treated as plain text (parses as
    // one big "word" line, since it's not valid word-separator text either;
    // JSON.parse succeeds so we must NOT silently drop it as 0 entries).
    const { entries } = parseImportedDictionary('{"foo": 1}');
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('mergeDictionaries', () => {
  it('imported entries win on a case-insensitive word match', () => {
    const existing = [entry('ChargeBee', { sounds_like: ['charge b'] })];
    const imported = [entry('chargebee', { sounds_like: ['charge bee', 'chargbee'] })];
    const merged = mergeDictionaries(existing, imported);
    expect(merged).toEqual([entry('chargebee', { sounds_like: ['charge bee', 'chargbee'] })]);
  });

  it('preserves existing order and appends new imported words at the end', () => {
    const existing = [entry('Alpha'), entry('Beta')];
    const imported = [entry('Gamma'), entry('Beta', { case_sensitive: true })];
    const merged = mergeDictionaries(existing, imported);
    expect(merged.map((e) => e.word)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(merged[1]).toEqual(entry('Beta', { case_sensitive: true }));
  });

  it('handles an empty existing list', () => {
    const imported = [entry('Solo')];
    expect(mergeDictionaries([], imported)).toEqual(imported);
  });

  it('handles an empty imported list (no-op)', () => {
    const existing = [entry('Solo')];
    expect(mergeDictionaries(existing, [])).toEqual(existing);
  });
});

describe('exportDictionaryJson', () => {
  it('round-trips through parseImportedDictionary', () => {
    const entries = [
      entry('ChargeBee', { sounds_like: ['charge bee'] }),
      entry('Kubernetes', { replace_exact: true }),
    ];
    const json = exportDictionaryJson(entries);
    const { entries: reparsed, skipped } = parseImportedDictionary(json);
    expect(skipped).toBe(0);
    expect(reparsed).toEqual(entries);
  });
});
