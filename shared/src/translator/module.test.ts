/**
 * The module surface is types-only, but T2's mock and T3's loader both build
 * objects against it — this test pins that a faithful in-memory fake satisfies
 * the interface (compile-time) and that the runtime enum constants match the
 * documented union values.
 */
import { PAIR_STATUSES, type PairStatus, type TranslatorModuleApi } from './module';
import { PACK_STATES } from './packs';

function makeFakeModule(): TranslatorModuleApi {
  const downloaded = new Set<string>(['en']);
  const supported = ['en', 'es', 'de'];
  const status = (from: string, to: string): PairStatus => {
    if (!supported.includes(from) || !supported.includes(to)) return 'unsupported';
    return downloaded.has(from) && downloaded.has(to) ? 'installed' : 'downloadable';
  };
  return {
    translate: async (text, from, to) => {
      if ((await status(from, to)) !== 'installed') throw new Error('pack missing');
      return { text: `[${from}→${to}] ${text}` };
    },
    getPairStatus: async (from, to) => status(from, to),
    downloadPack: async (from, to, opts) => {
      if (opts?.wifiOnly === false) {
        // cellular allowed — same behaviour for the fake
      }
      downloaded.add(from);
      downloaded.add(to);
    },
    listSupportedLanguages: async () => [...supported],
    listDownloadedLanguages: async () => [...downloaded],
    deletePack: async (lang) => downloaded.delete(lang),
    identifyLanguage: async (text) => (text ? 'en' : null),
    sttOnDeviceLocales: async () => null,
    isTranslationAvailable: async () => ({ available: true }),
  };
}

describe('TranslatorModuleApi contract', () => {
  it('a faithful fake satisfies the full surface', async () => {
    const mod = makeFakeModule();
    expect(await mod.getPairStatus('en', 'es')).toBe('downloadable');
    await expect(mod.translate('hi', 'en', 'es')).rejects.toThrow('pack missing');
    await mod.downloadPack('en', 'es', { wifiOnly: true });
    expect(await mod.getPairStatus('en', 'es')).toBe('installed');
    expect((await mod.translate('hi', 'en', 'es')).text).toBe('[en→es] hi');
    expect(await mod.getPairStatus('en', 'xx')).toBe('unsupported');
    expect(await mod.deletePack('es')).toBe(true);
    expect(await mod.deletePack('es')).toBe(false);
    expect(await mod.sttOnDeviceLocales()).toBeNull();
    expect(await mod.identifyLanguage('hello')).toBe('en');
    expect(await mod.identifyLanguage('')).toBeNull();
    expect(await mod.isTranslationAvailable()).toEqual({ available: true });
  });

  it('runtime constants mirror the type unions', () => {
    expect(PAIR_STATUSES).toEqual(['installed', 'downloadable', 'unsupported']);
    expect(PACK_STATES).toEqual(['installed', 'downloadable', 'downloading', 'unsupported']);
    // Every PairStatus is also a PackState (the client adds only 'downloading').
    for (const s of PAIR_STATUSES) {
      expect(PACK_STATES).toContain(s);
    }
  });
});
