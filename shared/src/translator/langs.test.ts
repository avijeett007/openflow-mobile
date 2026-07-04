import * as fs from 'fs';
import * as path from 'path';
import {
  FALLBACK_DISPLAY_NAMES,
  bcp47Primary,
  canonicalPrimary,
  computeUsable,
  displayLanguageName,
  langKey,
  pickSttLocale,
  toTranslationLang,
} from './langs';
import { initialPackMap, packReducer, type PackMap } from './packs';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures');

function loadCodes(name: string): string[] {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
  return fx.codes as string[];
}

/** Pinned platform language lists — the mapping layer's ground truth. */
const MLKIT = loadCodes('langs-mlkit.json');
const APPLE = loadCodes('langs-apple.json');

describe('pinned fixtures', () => {
  it('ML Kit list is the 59-language set with its legacy spellings', () => {
    expect(MLKIT).toHaveLength(59);
    expect(new Set(MLKIT).size).toBe(59);
    // The spellings ML Kit actually uses (not the modern aliases):
    for (const code of ['he', 'id', 'no', 'tl', 'zh', 'en', 'pt']) {
      expect(MLKIT).toContain(code);
    }
    for (const legacyAbsent of ['iw', 'in', 'nb', 'fil', 'zh-Hans', 'pt-BR']) {
      expect(MLKIT).not.toContain(legacyAbsent);
    }
    // Sorted + all-lowercase keeps the fixture canonical.
    expect(MLKIT).toEqual([...MLKIT].sort());
    expect(MLKIT.every((c) => c === c.toLowerCase())).toBe(true);
  });

  it('Apple list is the ~20-language iOS 18 set with script/region variants', () => {
    expect(APPLE).toHaveLength(21);
    expect(new Set(APPLE).size).toBe(21);
    for (const code of ['zh-Hans', 'zh-Hant', 'en-GB', 'en-US', 'pt-BR', 'es', 'uk']) {
      expect(APPLE).toContain(code);
    }
    // No Hebrew / Norwegian / Tagalog on Apple — the alias cases must fail here.
    for (const absent of ['he', 'iw', 'no', 'nb', 'tl', 'fil', 'zh', 'pt']) {
      expect(APPLE).not.toContain(absent);
    }
    // en-GB precedes en-US: the pinned order is the primary-fallback tie-break.
    expect(APPLE.indexOf('en-GB')).toBeLessThan(APPLE.indexOf('en-US'));
  });
});

describe('bcp47Primary / canonicalPrimary / langKey', () => {
  it('extracts the lowercased primary subtag, tolerating underscores', () => {
    expect(bcp47Primary('en-US')).toBe('en');
    expect(bcp47Primary('zh_TW')).toBe('zh');
    expect(bcp47Primary('FIL-PH')).toBe('fil');
    expect(bcp47Primary('de')).toBe('de');
    expect(bcp47Primary('')).toBe('');
    expect(bcp47Primary('  pt-BR ')).toBe('pt');
  });

  it('canonicalizes legacy aliases (iw/he, in/id, ji/yi, tl/fil, nb/no, mo/ro)', () => {
    expect(canonicalPrimary('iw-IL')).toBe('he');
    expect(canonicalPrimary('he')).toBe('he');
    expect(canonicalPrimary('in')).toBe('id');
    expect(canonicalPrimary('ji')).toBe('yi');
    expect(canonicalPrimary('tl')).toBe('fil');
    expect(canonicalPrimary('fil-PH')).toBe('fil');
    expect(canonicalPrimary('nb-NO')).toBe('no');
    expect(canonicalPrimary('no')).toBe('no');
    expect(canonicalPrimary('mo')).toBe('ro');
    // Nynorsk is deliberately NOT folded into Norwegian.
    expect(canonicalPrimary('nn-NO')).toBe('nn');
  });

  it('langKey keeps script distinctions for Chinese only', () => {
    expect(langKey('zh')).toBe('zh-hans');
    expect(langKey('zh-CN')).toBe('zh-hans');
    expect(langKey('zh-SG')).toBe('zh-hans');
    expect(langKey('zh-Hans')).toBe('zh-hans');
    expect(langKey('zh-Hans-CN')).toBe('zh-hans');
    expect(langKey('zh-TW')).toBe('zh-hant');
    expect(langKey('zh-HK')).toBe('zh-hant');
    expect(langKey('zh-MO')).toBe('zh-hant');
    expect(langKey('zh-Hant')).toBe('zh-hant');
    expect(langKey('zh-Hant-TW')).toBe('zh-hant');
    // Non-Chinese tags collapse to the canonical primary.
    expect(langKey('en-US')).toBe('en');
    expect(langKey('pt-BR')).toBe('pt');
    expect(langKey('iw-IL')).toBe('he');
    expect(langKey('sr-Cyrl-RS')).toBe('sr');
  });
});

describe('toTranslationLang — ML Kit (Android)', () => {
  it.each([
    // [STT locale or tag, expected ML Kit code]
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['es-419', 'es'],
    ['zh-CN', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh-TW', 'zh'], // single Chinese model — Traditional still maps (primary tier)
    ['zh-Hant-TW', 'zh'],
    ['pt-BR', 'pt'],
    ['pt-PT', 'pt'],
    ['iw-IL', 'he'],
    ['iw', 'he'],
    ['he-IL', 'he'],
    ['nb-NO', 'no'],
    ['nb', 'no'],
    ['no-NO', 'no'],
    ['fil-PH', 'tl'],
    ['fil', 'tl'],
    ['tl-PH', 'tl'],
    ['in-ID', 'id'], // legacy Indonesian
    ['vi-VN', 'vi'],
    ['cy-GB', 'cy'],
  ])('%s → %s', (tag, expected) => {
    expect(toTranslationLang(tag, MLKIT)).toBe(expected);
  });

  it.each(['yue-Hant-HK', 'nn-NO', 'am-ET', 'xx', ''])('%s has no ML Kit language → null', (tag) => {
    expect(toTranslationLang(tag, MLKIT)).toBeNull();
  });

  it('round-trips every ML Kit code onto itself', () => {
    for (const code of MLKIT) {
      expect(toTranslationLang(code, MLKIT)).toBe(code);
    }
  });
});

describe('toTranslationLang — Apple (iOS 18)', () => {
  it.each([
    ['en-US', 'en-US'], // exact region tier
    ['en-GB', 'en-GB'],
    ['en-AU', 'en-GB'], // primary fallback: first English in the pinned list
    ['en', 'en-GB'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-Hant', 'zh-Hant'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-BR'], // Apple only ships Brazilian Portuguese
    ['pt', 'pt-BR'],
    ['es-MX', 'es'],
    ['uk-UA', 'uk'],
    ['hi-IN', 'hi'],
    ['in-ID', 'id'],
  ])('%s → %s', (tag, expected) => {
    expect(toTranslationLang(tag, APPLE)).toBe(expected);
  });

  it.each(['he-IL', 'iw-IL', 'nb-NO', 'fil-PH', 'sv-SE', 'da-DK'])(
    '%s is not translatable on Apple → null',
    (tag) => {
      expect(toTranslationLang(tag, APPLE)).toBeNull();
    },
  );

  it('round-trips every Apple code onto itself', () => {
    for (const code of APPLE) {
      expect(toTranslationLang(code, APPLE)).toBe(code);
    }
  });
});

describe('pickSttLocale', () => {
  const STT = ['en-US', 'en-GB', 'es-ES', 'zh-CN', 'zh-TW', 'iw-IL', 'fil-PH', 'nb-NO', 'pt-PT', 'pt-BR'];

  it.each([
    ['en-US', 'en-US'],
    ['en-GB', 'en-GB'],
    ['en', 'en-US'], // first English in STT list order
    ['zh-Hans', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['he', 'iw-IL'], // alias round-trip
    ['tl', 'fil-PH'],
    ['no', 'nb-NO'],
    ['pt', 'pt-PT'], // langKey tie → STT list order
    ['pt-BR', 'pt-BR'],
  ])('%s → %s', (lang, expected) => {
    expect(pickSttLocale(lang, STT)).toBe(expected);
  });

  it('returns null when the device has no recognizer for the language', () => {
    expect(pickSttLocale('ja', STT)).toBeNull();
    expect(pickSttLocale('uk', STT)).toBeNull();
  });

  it('round-trips STT ↔ translation across both platform lists', () => {
    for (const available of [MLKIT, APPLE]) {
      for (const lang of available) {
        const locale = pickSttLocale(lang, STT);
        if (locale !== null) {
          // Whatever locale we picked must map back to the same translation code.
          expect(toTranslationLang(locale, available)).toBe(lang);
        }
      }
    }
  });
});

describe('displayLanguageName', () => {
  it('names common codes (ICU path)', () => {
    expect(displayLanguageName('en')).toBe('English');
    expect(displayLanguageName('zh-Hans')).toMatch(/Chinese/);
    expect(displayLanguageName('zh-Hant')).toMatch(/Chinese/);
    expect(displayLanguageName('pt-BR')).toMatch(/Portuguese/);
  });

  it('never echoes a bare code for either platform list', () => {
    for (const code of [...MLKIT, ...APPLE]) {
      const name = displayLanguageName(code);
      expect(name).not.toBe(code);
      expect(name.length).toBeGreaterThan(2);
    }
  });

  it('falls back to the built-in table when Intl.DisplayNames is unavailable', () => {
    const intl = globalThis.Intl as { DisplayNames?: unknown };
    const original = intl.DisplayNames;
    // eslint-disable-next-line no-param-reassign
    intl.DisplayNames = undefined;
    try {
      expect(displayLanguageName('zh-Hant')).toBe('Chinese (Traditional)');
      expect(displayLanguageName('iw')).toBe('Hebrew'); // alias-resolved lookup
      expect(displayLanguageName('en-US')).toBe('English (US)');
      for (const code of [...MLKIT, ...APPLE]) {
        expect(displayLanguageName(code)).not.toBe(code);
      }
      // Truly unknown codes echo through rather than throw.
      expect(displayLanguageName('xx-YY')).toBe('xx-YY');
    } finally {
      intl.DisplayNames = original;
    }
  });

  it('the fallback table covers both pinned platform lists', () => {
    for (const code of [...MLKIT, ...APPLE]) {
      const key = langKey(code);
      const full = code.toLowerCase();
      expect(FALLBACK_DISPLAY_NAMES[full] ?? FALLBACK_DISPLAY_NAMES[key]).toBeDefined();
    }
  });
});

describe('computeUsable', () => {
  const packsFor = (supported: string[], downloaded: string[]): PackMap =>
    packReducer(initialPackMap, { type: 'SYNC', supported, downloaded });

  it('intersects STT locales, translation langs and pack states', () => {
    const langs = ['en', 'es', 'ja', 'he'];
    const packs = packsFor(langs, ['en', 'es', 'ja']);
    const stt = ['en-US', 'es-ES', 'iw-IL'];
    const rows = computeUsable(stt, langs, packs);
    const byLang = Object.fromEntries(rows.map((r) => [r.lang, r]));

    // en/es: installed pack + STT → usable.
    expect(byLang.en).toMatchObject({ usable: true, sttLocale: 'en-US', pack: 'installed', sttKnown: true });
    expect(byLang.es).toMatchObject({ usable: true, sttLocale: 'es-ES', pack: 'installed' });
    // ja: pack installed but NO on-device STT → not usable (missing-STT case).
    expect(byLang.ja).toMatchObject({ usable: false, sttLocale: null, pack: 'installed', sttKnown: true });
    // he: STT exists (via iw alias) but pack not downloaded → not usable yet.
    expect(byLang.he).toMatchObject({ usable: false, sttLocale: 'iw-IL', pack: 'downloadable' });
  });

  it('downloading packs are not usable yet', () => {
    let packs = packsFor(['en', 'es'], ['en']);
    packs = packReducer(packs, { type: 'DOWNLOAD_START', lang: 'es' });
    const rows = computeUsable(['en-US', 'es-ES'], ['en', 'es'], packs);
    const es = rows.find((r) => r.lang === 'es')!;
    expect(es.pack).toBe('downloading');
    expect(es.usable).toBe(false);
  });

  it('null STT locales (enumeration unavailable) → STT unknown, pack state decides', () => {
    const packs = packsFor(['en', 'es'], ['en']);
    const rows = computeUsable(null, ['en', 'es'], packs);
    const byLang = Object.fromEntries(rows.map((r) => [r.lang, r]));
    expect(byLang.en).toMatchObject({ usable: true, sttLocale: null, sttKnown: false });
    expect(byLang.es).toMatchObject({ usable: false, pack: 'downloadable', sttKnown: false });
  });

  it('unsynced pack map defaults supported languages to downloadable', () => {
    const rows = computeUsable(['en-US'], ['en'], initialPackMap);
    expect(rows[0]).toMatchObject({ lang: 'en', pack: 'downloadable', usable: false });
  });

  it('sorts ready → installed-no-STT → downloading → downloadable, alphabetical within groups', () => {
    let packs = packsFor(['de', 'en', 'es', 'fr', 'ja'], ['en', 'es', 'ja']);
    packs = packReducer(packs, { type: 'DOWNLOAD_START', lang: 'fr' });
    const rows = computeUsable(['en-US', 'es-ES', 'de-DE'], ['de', 'en', 'es', 'fr', 'ja'], packs);
    expect(rows.map((r) => r.lang)).toEqual([
      'en', // usable (English < Spanish)
      'es', // usable
      'ja', // installed, no STT
      'fr', // downloading
      'de', // downloadable
    ]);
  });

  it('works end-to-end against the pinned Apple list (zh variants stay distinct)', () => {
    const packs = packsFor(APPLE, ['zh-Hans', 'en-US']);
    const stt = ['zh-CN', 'zh-TW', 'en-US'];
    const rows = computeUsable(stt, APPLE, packs);
    const byLang = Object.fromEntries(rows.map((r) => [r.lang, r]));
    expect(byLang['zh-Hans']).toMatchObject({ usable: true, sttLocale: 'zh-CN' });
    expect(byLang['zh-Hant']).toMatchObject({ usable: false, pack: 'downloadable', sttLocale: 'zh-TW' });
    expect(byLang['en-US']).toMatchObject({ usable: true, sttLocale: 'en-US' });
    expect(byLang['en-GB']).toMatchObject({ pack: 'downloadable' });
    expect(rows).toHaveLength(APPLE.length);
  });

  it('works end-to-end against the pinned ML Kit list (aliases resolve)', () => {
    const packs = packsFor(MLKIT, ['he', 'no', 'tl', 'zh', 'en']);
    const stt = ['iw-IL', 'nb-NO', 'fil-PH', 'zh-CN', 'en-US'];
    const rows = computeUsable(stt, MLKIT, packs);
    const byLang = Object.fromEntries(rows.map((r) => [r.lang, r]));
    expect(byLang.he).toMatchObject({ usable: true, sttLocale: 'iw-IL' });
    expect(byLang.no).toMatchObject({ usable: true, sttLocale: 'nb-NO' });
    expect(byLang.tl).toMatchObject({ usable: true, sttLocale: 'fil-PH' });
    expect(byLang.zh).toMatchObject({ usable: true, sttLocale: 'zh-CN' });
    expect(rows).toHaveLength(59);
    expect(rows.filter((r) => r.usable)).toHaveLength(5);
  });
});
