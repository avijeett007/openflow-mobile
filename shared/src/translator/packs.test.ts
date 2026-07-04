import {
  getPackState,
  initialPackMap,
  packReducer as reduce,
  type PackMap,
} from './packs';

const sync = (supported: string[], downloaded: string[], state: PackMap = initialPackMap) =>
  reduce(state, { type: 'SYNC', supported, downloaded });

describe('SYNC', () => {
  it('marks downloaded languages installed and the rest downloadable', () => {
    const s = sync(['en', 'es', 'de'], ['en']);
    expect(s).toEqual({ en: 'installed', es: 'downloadable', de: 'downloadable' });
  });

  it('drops languages no longer supported', () => {
    const s1 = sync(['en', 'es'], ['en']);
    const s2 = sync(['en'], ['en'], s1);
    expect(s2).toEqual({ en: 'installed' });
  });

  it('preserves an in-flight download across a re-sync', () => {
    let s = sync(['en', 'es'], []);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'es' });
    s = sync(['en', 'es'], [], s);
    expect(s.es).toBe('downloading');
  });

  it('a re-sync that reports the pack downloaded wins over downloading', () => {
    let s = sync(['en', 'es'], []);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'es' });
    s = sync(['en', 'es'], ['es'], s);
    expect(s.es).toBe('installed');
  });

  it('matches downloaded codes across alias spellings (iw ↔ he, nb ↔ no, fil ↔ tl)', () => {
    const s = sync(['he', 'no', 'tl'], ['iw', 'nb-NO', 'fil']);
    expect(s).toEqual({ he: 'installed', no: 'installed', tl: 'installed' });
  });

  it('keeps Apple region/script variants distinct (downloaded en-US must NOT install en-GB)', () => {
    const s = sync(['en-GB', 'en-US', 'zh-Hans', 'zh-Hant', 'pt-BR'], ['en-US', 'zh-Hans']);
    expect(s).toEqual({
      'en-GB': 'downloadable',
      'en-US': 'installed',
      'zh-Hans': 'installed',
      'zh-Hant': 'downloadable',
      'pt-BR': 'downloadable',
    });
  });
});

describe('download lifecycle', () => {
  it('DOWNLOAD_START: downloadable → downloading', () => {
    let s = sync(['es'], []);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'es' });
    expect(s.es).toBe('downloading');
  });

  it('DOWNLOAD_START is ignored for installed, downloading and unknown languages', () => {
    let s = sync(['en', 'es'], ['en']);
    expect(reduce(s, { type: 'DOWNLOAD_START', lang: 'en' })).toBe(s);
    expect(reduce(s, { type: 'DOWNLOAD_START', lang: 'xx' })).toBe(s);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'es' });
    expect(reduce(s, { type: 'DOWNLOAD_START', lang: 'es' })).toBe(s);
  });

  it('DOWNLOAD_DONE: → installed (from downloading or straight from downloadable)', () => {
    let s = sync(['es', 'de'], []);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'es' });
    s = reduce(s, { type: 'DOWNLOAD_DONE', lang: 'es' });
    s = reduce(s, { type: 'DOWNLOAD_DONE', lang: 'de' });
    expect(s).toEqual({ es: 'installed', de: 'installed' });
  });

  it('DOWNLOAD_DONE for a language not in the map is a no-op', () => {
    const s = sync(['es'], []);
    expect(reduce(s, { type: 'DOWNLOAD_DONE', lang: 'xx' })).toBe(s);
  });

  it('DOWNLOAD_FAILED: downloading → downloadable; ignored otherwise', () => {
    let s = sync(['es', 'en'], ['en']);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'es' });
    s = reduce(s, { type: 'DOWNLOAD_FAILED', lang: 'es' });
    expect(s.es).toBe('downloadable');
    expect(reduce(s, { type: 'DOWNLOAD_FAILED', lang: 'es' })).toBe(s);
    expect(reduce(s, { type: 'DOWNLOAD_FAILED', lang: 'en' })).toBe(s);
  });

  it('PACK_DELETED: installed → downloadable; ignored otherwise', () => {
    let s = sync(['en', 'es'], ['en']);
    s = reduce(s, { type: 'PACK_DELETED', lang: 'en' });
    expect(s.en).toBe('downloadable');
    expect(reduce(s, { type: 'PACK_DELETED', lang: 'es' })).toBe(s);
    expect(reduce(s, { type: 'PACK_DELETED', lang: 'xx' })).toBe(s);
  });

  it('lifecycle actions accept alias spellings of the map key', () => {
    let s = sync(['he'], []);
    s = reduce(s, { type: 'DOWNLOAD_START', lang: 'iw-IL' });
    expect(s.he).toBe('downloading');
    s = reduce(s, { type: 'DOWNLOAD_DONE', lang: 'iw' });
    expect(s.he).toBe('installed');
  });
});

describe('getPackState', () => {
  const s = sync(['he', 'no', 'zh', 'pt'], ['he']);

  it('exact and alias-tolerant lookups', () => {
    expect(getPackState(s, 'he')).toBe('installed');
    expect(getPackState(s, 'iw')).toBe('installed');
    expect(getPackState(s, 'iw-IL')).toBe('installed');
    expect(getPackState(s, 'nb-NO')).toBe('downloadable');
    expect(getPackState(s, 'pt-BR')).toBe('downloadable');
  });

  it('zh region variants resolve to the single ML Kit zh pack', () => {
    // zh-CN is Hans like bare zh → langKey match.
    expect(getPackState(s, 'zh-CN')).toBe('downloadable');
  });

  it('unknown languages are unsupported', () => {
    expect(getPackState(s, 'xx')).toBe('unsupported');
    expect(getPackState(initialPackMap, 'en')).toBe('unsupported');
  });
});
