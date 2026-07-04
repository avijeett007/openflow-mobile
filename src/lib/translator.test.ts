import type { TranslatorModuleApi } from '@openflow/shared';
import { createTranslator } from './translator';

describe('createTranslator — module missing (Expo Go / Jest / web)', () => {
  const t = createTranslator(() => null);

  it('reports translation unavailable with a reason', async () => {
    const res = await t.isTranslationAvailable();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/native module|Simulator|development/i);
  });

  it('translate / downloadPack reject cleanly', async () => {
    await expect(t.translate('hi', 'en', 'es')).rejects.toThrow(/not available/i);
    await expect(t.downloadPack('en', 'es')).rejects.toThrow(/not available/i);
  });

  it('list + identify + locale queries degrade to empty/null/unsupported', async () => {
    expect(await t.listSupportedLanguages()).toEqual([]);
    expect(await t.listDownloadedLanguages()).toEqual([]);
    expect(await t.getPairStatus('en', 'es')).toBe('unsupported');
    expect(await t.identifyLanguage('hola')).toBeNull();
    expect(await t.sttOnDeviceLocales()).toBeNull();
    expect(await t.deletePack('es')).toBe(false);
  });
});

describe('createTranslator — module present', () => {
  function fakeModule(): jest.Mocked<TranslatorModuleApi> {
    return {
      translate: jest.fn(async () => ({ text: 'hola' })),
      getPairStatus: jest.fn(async () => 'installed'),
      downloadPack: jest.fn(async () => undefined),
      listSupportedLanguages: jest.fn(async () => ['en', 'es']),
      listDownloadedLanguages: jest.fn(async () => ['en']),
      deletePack: jest.fn(async () => true),
      identifyLanguage: jest.fn(async () => 'es'),
      sttOnDeviceLocales: jest.fn(async () => ['en-US']),
      isTranslationAvailable: jest.fn(async () => ({ available: true })),
    } as unknown as jest.Mocked<TranslatorModuleApi>;
  }

  it('delegates to the native module', async () => {
    const mod = fakeModule();
    const t = createTranslator(() => mod);
    expect(await t.translate('hi', 'en', 'es')).toEqual({ text: 'hola' });
    expect(mod.translate).toHaveBeenCalledWith('hi', 'en', 'es');
    expect(await t.getPairStatus('en', 'es')).toBe('installed');
    expect((await t.isTranslationAvailable()).available).toBe(true);
  });

  it('list methods swallow native errors → empty', async () => {
    const mod = fakeModule();
    mod.listSupportedLanguages.mockRejectedValue(new Error('boom'));
    const t = createTranslator(() => mod);
    expect(await t.listSupportedLanguages()).toEqual([]);
  });
});
