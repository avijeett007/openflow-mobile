import {
  MODULE_UNAVAILABLE,
  createTranslator,
  normalizeError,
} from '../../index';
import type { TranslatorNativeModule } from '../Translator.types';

/** A fully-stubbed native module; individual tests override methods as needed. */
function makeFakeModule(overrides: Partial<TranslatorNativeModule> = {}): jest.Mocked<TranslatorNativeModule> {
  return {
    translate: jest.fn(async () => ({ text: 'hola' })),
    getPairStatus: jest.fn(async () => 'installed' as const),
    downloadPack: jest.fn(async () => undefined),
    listSupportedLanguages: jest.fn(async () => ['en', 'es']),
    listDownloadedLanguages: jest.fn(async () => ['en']),
    deletePack: jest.fn(async () => true),
    identifyLanguage: jest.fn(async () => 'es'),
    sttOnDeviceLocales: jest.fn(async () => ['en-US']),
    isTranslationAvailable: jest.fn(async () => ({ available: true })),
    ...overrides,
  } as jest.Mocked<TranslatorNativeModule>;
}

describe('createTranslator — module missing (Jest / Expo Go / web)', () => {
  const t = createTranslator(() => null);

  it('isTranslationAvailable reports unavailable with a reason', async () => {
    const res = await t.isTranslationAvailable();
    expect(res.available).toBe(false);
    expect(res.reason).toBe(MODULE_UNAVAILABLE);
  });

  it('translate rejects with the module-missing message', async () => {
    await expect(t.translate('hi', 'en', 'es')).rejects.toThrow(/native module missing/i);
  });

  it('downloadPack rejects with the module-missing message', async () => {
    await expect(t.downloadPack('en', 'es')).rejects.toThrow(/native module missing/i);
  });

  it('getPairStatus resolves "unsupported"', async () => {
    await expect(t.getPairStatus('en', 'es')).resolves.toBe('unsupported');
  });

  it('list* resolve empty, deletePack false, identify/stt null', async () => {
    await expect(t.listSupportedLanguages()).resolves.toEqual([]);
    await expect(t.listDownloadedLanguages()).resolves.toEqual([]);
    await expect(t.deletePack('es')).resolves.toBe(false);
    await expect(t.identifyLanguage('hola')).resolves.toBeNull();
    await expect(t.sttOnDeviceLocales()).resolves.toBeNull();
  });
});

describe('createTranslator — happy path delegates to native', () => {
  it('translate passes args through and returns the result', async () => {
    const mod = makeFakeModule();
    const res = await createTranslator(() => mod).translate('hi', 'en', 'es');
    expect(res).toEqual({ text: 'hola' });
    expect(mod.translate).toHaveBeenCalledWith('hi', 'en', 'es');
  });

  it('identifyLanguage passes null through unchanged', async () => {
    const mod = makeFakeModule({ identifyLanguage: jest.fn(async () => null) });
    await expect(createTranslator(() => mod).identifyLanguage('???')).resolves.toBeNull();
  });

  it('sttOnDeviceLocales passes null through (Android)', async () => {
    const mod = makeFakeModule({ sttOnDeviceLocales: jest.fn(async () => null) });
    await expect(createTranslator(() => mod).sttOnDeviceLocales()).resolves.toBeNull();
  });
});

describe('downloadPack — wifiOnly default', () => {
  it('defaults wifiOnly to true when no options given', async () => {
    const mod = makeFakeModule();
    await createTranslator(() => mod).downloadPack('en', 'es');
    expect(mod.downloadPack).toHaveBeenCalledWith('en', 'es', true);
  });

  it('honours an explicit wifiOnly:false', async () => {
    const mod = makeFakeModule();
    await createTranslator(() => mod).downloadPack('en', 'es', { wifiOnly: false });
    expect(mod.downloadPack).toHaveBeenCalledWith('en', 'es', false);
  });

  it('honours an explicit wifiOnly:true', async () => {
    const mod = makeFakeModule();
    await createTranslator(() => mod).downloadPack('en', 'es', { wifiOnly: true });
    expect(mod.downloadPack).toHaveBeenCalledWith('en', 'es', true);
  });
});

describe('getPairStatus — caching + invalidation', () => {
  it('memoizes repeated reads of the same pair', async () => {
    const mod = makeFakeModule();
    const t = createTranslator(() => mod);
    await t.getPairStatus('en', 'es');
    await t.getPairStatus('en', 'es');
    expect(mod.getPairStatus).toHaveBeenCalledTimes(1);
  });

  it('caches per-direction (en→es and es→en are distinct)', async () => {
    const mod = makeFakeModule();
    const t = createTranslator(() => mod);
    await t.getPairStatus('en', 'es');
    await t.getPairStatus('es', 'en');
    expect(mod.getPairStatus).toHaveBeenCalledTimes(2);
  });

  it('downloadPack invalidates the cache (next read re-queries native)', async () => {
    const mod = makeFakeModule();
    const t = createTranslator(() => mod);
    await t.getPairStatus('en', 'es');
    await t.downloadPack('en', 'es');
    await t.getPairStatus('en', 'es');
    expect(mod.getPairStatus).toHaveBeenCalledTimes(2);
  });

  it('deletePack invalidates the cache', async () => {
    const mod = makeFakeModule();
    const t = createTranslator(() => mod);
    await t.getPairStatus('en', 'es');
    await t.deletePack('es');
    await t.getPairStatus('en', 'es');
    expect(mod.getPairStatus).toHaveBeenCalledTimes(2);
  });

  it('still invalidates the cache when downloadPack rejects', async () => {
    const mod = makeFakeModule({
      downloadPack: jest.fn(async () => {
        throw new Error('user cancelled');
      }),
    });
    const t = createTranslator(() => mod);
    await t.getPairStatus('en', 'es');
    await expect(t.downloadPack('en', 'es')).rejects.toThrow('user cancelled');
    await t.getPairStatus('en', 'es');
    expect(mod.getPairStatus).toHaveBeenCalledTimes(2);
  });
});

describe('error normalization', () => {
  it('translate surfaces the native CodedError message + code', async () => {
    const mod = makeFakeModule({
      translate: jest.fn(async () => {
        throw { code: 'ERR_TRANSLATE_OFFLINE', message: 'Offline models not available' };
      }),
    });
    await expect(createTranslator(() => mod).translate('hi', 'en', 'es')).rejects.toThrow(
      'Offline models not available',
    );
  });

  it('isTranslationAvailable converts a thrown check into { available:false }', async () => {
    const mod = makeFakeModule({
      isTranslationAvailable: jest.fn(async () => {
        throw new Error('framework exploded');
      }),
    });
    const res = await createTranslator(() => mod).isTranslationAvailable();
    expect(res).toEqual({ available: false, reason: 'framework exploded' });
  });

  it('normalizeError maps a CodedError object to an Error with .code', () => {
    const e = normalizeError({ code: 'ERR_X', message: 'boom' }) as Error & { code?: string };
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('boom');
    expect(e.code).toBe('ERR_X');
  });

  it('normalizeError falls back to a generic message for empty input', () => {
    expect(normalizeError(undefined).message).toMatch(/translation failed/i);
    expect(normalizeError('').message).toMatch(/translation failed/i);
  });

  it('normalizeError passes a real Error through untouched', () => {
    const original = new Error('keep me');
    expect(normalizeError(original)).toBe(original);
  });
});
