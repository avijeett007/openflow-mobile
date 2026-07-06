import type { DictionaryEntry } from '../settings/schema';
import {
  applyDictionary,
  applyDictionaryAliasesOnly,
  correctTranscript,
  dictionaryWords,
} from './engine';
import { soundex } from './soundex';
import {
  buildPromptString,
  deepgramBiasingStyle,
  deepgramKeytermWords,
  dictionaryVocabularyBlock,
} from './biasing';

function entry(
  word: string,
  sounds_like: string[] = [],
  extra: Partial<Pick<DictionaryEntry, 'replace_exact' | 'case_sensitive'>> = {},
): DictionaryEntry {
  return { word, sounds_like, replace_exact: false, case_sensitive: false, ...extra };
}

// ---- Exact-alias pass (deterministic, threshold-independent) ---------------

describe('applyDictionary — exact alias pass', () => {
  it('rewrites a single-word alias to the canonical word', () => {
    const entries = [entry('Kubernetes', ['kubernetis', 'coober netties'])];
    expect(applyDictionary('we deploy on kubernetis today', entries)).toBe(
      'we deploy on Kubernetes today',
    );
  });

  it('rewrites a multi-word alias via n-gram matching', () => {
    const entries = [entry('MySQL', ['my sequel'])];
    expect(applyDictionary('store it in my sequel please', entries)).toBe(
      'store it in MySQL please',
    );
  });

  it('fires even at threshold 0 (fuzzy disabled) — homophone rules are deterministic', () => {
    const entries = [entry('ChargeBee', ['charge bee'])];
    expect(applyDictionary('the charge bee invoice', entries, 0.0)).toBe('the ChargeBee invoice');
  });

  it('maps the regression aliases charge bee → ChargeBee and kubernetis → Kubernetes', () => {
    const entries = [entry('ChargeBee', ['charge bee']), entry('Kubernetes', ['kubernetis'])];
    expect(applyDictionary('bill via charge bee on kubernetis', entries)).toBe(
      'bill via ChargeBee on Kubernetes',
    );
  });

  it('preserves trailing punctuation around an alias replacement', () => {
    const entries = [entry('ChargeBee', ['charge bee'])];
    expect(applyDictionary('use charge bee, please', entries, 0.0)).toContain('ChargeBee,');
  });
});

// ---- Fuzzy pass ------------------------------------------------------------

describe('applyDictionary — fuzzy pass', () => {
  it('corrects near-misses of canonical words', () => {
    const entries = [entry('hello'), entry('world')];
    expect(applyDictionary('helo wrold', entries, 0.5)).toBe('hello world');
  });

  it('joins split words into a canonical single word (Charge B → ChargeBee)', () => {
    const entries = [entry('ChargeBee')];
    expect(applyDictionary('use Charge B today', entries)).toBe('use ChargeBee today');
  });

  it('prefers the longer n-gram when both would match', () => {
    const entries = [entry('OpenAI'), entry('GPT')];
    expect(applyDictionary('Open AI GPT model', entries, 0.5)).toBe('OpenAI GPT model');
  });

  it('a fuzzy hit on an alias resolves to the canonical word', () => {
    const entries = [entry('Kubernetes', ['kubernetes cluster'])];
    expect(applyDictionary('our kubernetis stack', entries, 0.3)).toContain('Kubernetes');
  });

  it('replace_exact disables fuzzy on the word but the alias still fires', () => {
    const entries = [entry('ChargeBee', ['charge bee'], { replace_exact: true })];
    // Fuzzy near-miss on the canonical word is left untouched.
    expect(applyDictionary('the chargebe invoice', entries, 0.5)).toBe('the chargebe invoice');
    // Deterministic alias still fires.
    expect(applyDictionary('the charge bee invoice', entries, 0.5)).toBe('the ChargeBee invoice');
  });
});

// ---- Case handling ---------------------------------------------------------

describe('applyDictionary — casing', () => {
  it('case_sensitive emits the word verbatim (sentence-start cap not mirrored)', () => {
    const entries = [entry('iOS', ['i o s'], { case_sensitive: true })];
    const result = applyDictionary('I o s is great', entries);
    expect(result).toContain('iOS');
    expect(result).not.toContain('IOS');
  });

  it('without case_sensitive, an all-caps input yields an all-caps output', () => {
    const entries = [entry('ChargeBee', ['charge bee'])];
    expect(applyDictionary('CHARGE BEE is great', entries)).toContain('CHARGEBEE');
  });
});

// ---- aliases-only mode -----------------------------------------------------

describe('applyDictionaryAliasesOnly', () => {
  it('fires exact aliases but never the fuzzy pass', () => {
    const entries = [entry('ChargeBee', ['charge bee'])];
    expect(applyDictionaryAliasesOnly('the charge bee invoice', entries)).toBe(
      'the ChargeBee invoice',
    );
    expect(applyDictionaryAliasesOnly('the chargebe invoice', entries)).toBe('the chargebe invoice');
  });
});

// ---- Edge-trim guard: fuzzy n-grams must not swallow function words ---------

describe('applyDictionary — edge-trim guard', () => {
  it('preserves function words in the full regression sentence', () => {
    const entries = [
      entry('ChargeBee', ['charge bee']),
      entry('Kubernetes', ['kubernetis']),
      entry('MacBook Pro'),
    ];
    expect(
      applyDictionary(
        "Let's set up Charge B and Kubernetes on my MacBook Pro today",
        entries,
      ),
    ).toBe("Let's set up ChargeBee and Kubernetes on my MacBook Pro today");
  });

  it('does not collapse "Kubernetes on" → "Kubernetes" (drops "on")', () => {
    expect(applyDictionary('Kubernetes on', [entry('Kubernetes')])).toBe('Kubernetes on');
  });

  it('keeps a leading function word: "my MacBook Pro"', () => {
    expect(applyDictionary('my MacBook Pro', [entry('MacBook Pro')])).toBe('my MacBook Pro');
  });

  it('shrinks a 3-gram to the winning 2-gram, leaving the trailing words', () => {
    expect(applyDictionary('Charge B and something', [entry('ChargeBee')])).toBe(
      'ChargeBee and something',
    );
  });

  it('still allows a legitimate multi-word join', () => {
    expect(applyDictionary('use Charge B today', [entry('ChargeBee')])).toBe('use ChargeBee today');
  });
});

// ---- Unicode safety --------------------------------------------------------

describe('applyDictionary — unicode', () => {
  it('preserves a multi-byte leading punctuation mark around a replacement', () => {
    const entries = [entry('Hola', ['hola'])];
    expect(applyDictionary('dice ¿hola mundo', entries, 0.5)).toBe('dice ¿Hola mundo');
  });

  it('preserves multi-byte CJK bracket punctuation around a replacement', () => {
    const entries = [entry('Test', ['テスト'], { case_sensitive: true })];
    // The bracketed token trims to the alias "テスト"; the 3-byte 「 」 brackets
    // must survive around the canonical replacement without corrupting the token.
    expect(applyDictionary('say 「テスト」 now', entries)).toBe('say 「Test」 now');
  });

  it('does not throw on emoji / astral code points', () => {
    expect(() => applyDictionary('hi 👋 there', [entry('Hi')])).not.toThrow();
  });
});

// ---- No-op / helpers -------------------------------------------------------

describe('applyDictionary — no-op', () => {
  it('returns the input unchanged for an empty dictionary', () => {
    expect(applyDictionary('hello world', [])).toBe('hello world');
  });
});

describe('dictionaryWords', () => {
  it('returns canonical words, dropping blank ones', () => {
    expect(dictionaryWords([entry('ChargeBee'), entry('   '), entry('Kubernetes')])).toEqual([
      'ChargeBee',
      'Kubernetes',
    ]);
  });
});

describe('correctTranscript', () => {
  const entries = [entry('ChargeBee', ['charge bee'])];

  it('runs the full pass when not prompted', () => {
    expect(correctTranscript('use Charge B today', entries, false)).toBe('use ChargeBee today');
  });

  it('runs aliases-only when prompted (skips fuzzy)', () => {
    expect(correctTranscript('use Charge B today', entries, true)).toBe('use Charge B today');
    expect(correctTranscript('the charge bee invoice', entries, true)).toBe('the ChargeBee invoice');
  });

  it('is a no-op for an empty dictionary regardless of prompted', () => {
    expect(correctTranscript('unchanged text', [], false)).toBe('unchanged text');
    expect(correctTranscript('unchanged text', [], true)).toBe('unchanged text');
  });
});

// ---- Soundex ---------------------------------------------------------------

describe('soundex', () => {
  it('matches known homophones', () => {
    expect(soundex('robert', 'rupert')).toBe(true);
    expect(soundex('ashcraft', 'ashcroft')).toBe(true);
  });

  it('does not match clearly different words', () => {
    expect(soundex('hello', 'zebra')).toBe(false);
  });

  it('returns false when either side has no letters', () => {
    expect(soundex('', 'hello')).toBe(false);
    expect(soundex('1234', 'hello')).toBe(false);
  });
});

// ---- Biasing helpers (L2 / L3) ---------------------------------------------

describe('buildPromptString', () => {
  it('returns null for an empty / all-blank list', () => {
    expect(buildPromptString([], 800)).toBeNull();
    expect(buildPromptString(['', '   '], 800)).toBeNull();
  });

  it('joins with ", " and drops blanks', () => {
    expect(buildPromptString(['ChargeBee', '', 'Kubernetes'], 800)).toBe('ChargeBee, Kubernetes');
  });

  it('truncates by keeping the tail (drops earliest words)', () => {
    // Budget fits only the last two words.
    const result = buildPromptString(['aaaa', 'bbbb', 'cccc'], 10);
    expect(result).toBe('bbbb, cccc');
  });

  it('sends a single oversized word rather than nothing', () => {
    expect(buildPromptString(['supercalifragilistic'], 5)).toBe('supercalifragilistic');
  });
});

describe('deepgramBiasingStyle', () => {
  it('uses keyterm for Nova-3 and Flux (case-insensitive)', () => {
    expect(deepgramBiasingStyle('nova-3')).toBe('keyterm');
    expect(deepgramBiasingStyle('Nova-3-General')).toBe('keyterm');
    expect(deepgramBiasingStyle('flux-general-en')).toBe('keyterm');
  });

  it('uses keywords for legacy models', () => {
    expect(deepgramBiasingStyle('nova-2')).toBe('keywords');
    expect(deepgramBiasingStyle('whisper-large')).toBe('keywords');
  });
});

describe('deepgramKeytermWords', () => {
  it('includes canonical words AND sounds_like aliases, dropping blanks', () => {
    const words = deepgramKeytermWords([
      entry('ChargeBee', ['charge bee', '  ']),
      entry('Kubernetes', ['kubernetis']),
    ]);
    expect(words).toEqual(['ChargeBee', 'charge bee', 'Kubernetes', 'kubernetis']);
  });
});

describe('dictionaryVocabularyBlock', () => {
  it('returns null for an empty dictionary', () => {
    expect(dictionaryVocabularyBlock([])).toBeNull();
  });

  it('lists canonical words only, never aliases, and starts with "Vocabulary"', () => {
    const block = dictionaryVocabularyBlock([
      entry('ChargeBee', ['charge bee']),
      entry('Kubernetes', ['kubernetis']),
    ]);
    expect(block).not.toBeNull();
    expect(block).toMatch(/^Vocabulary/);
    expect(block).toContain('ChargeBee');
    expect(block).toContain('Kubernetes');
    expect(block).not.toContain('charge bee');
    expect(block).not.toContain('kubernetis');
  });
});
