import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { TranslatorModuleApi } from '@openflow/shared';
import { useTranslatorCatalog } from './useTranslatorCatalog';

function fakeTranslator(over: Partial<TranslatorModuleApi> = {}): TranslatorModuleApi {
  return {
    translate: jest.fn(async () => ({ text: '' })),
    getPairStatus: jest.fn(async () => 'downloadable'),
    downloadPack: jest.fn(async () => undefined),
    listSupportedLanguages: jest.fn(async () => ['en', 'es']),
    listDownloadedLanguages: jest.fn(async () => ['en']),
    deletePack: jest.fn(async () => true),
    identifyLanguage: jest.fn(async () => null),
    sttOnDeviceLocales: jest.fn(async () => ['en-US', 'es-ES']),
    isTranslationAvailable: jest.fn(async () => ({ available: true })),
    ...over,
  };
}

function setup(translator: TranslatorModuleApi) {
  return renderHook(() =>
    useTranslatorCatalog({ translator, getSttLocales: async () => ['en-US', 'es-ES'] }),
  );
}

describe('useTranslatorCatalog', () => {
  it('loads the catalogue and computes usable rows (installed first)', async () => {
    const { result } = setup(fakeTranslator());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const en = result.current.usable.find((r) => r.lang === 'en');
    const es = result.current.usable.find((r) => r.lang === 'es');
    expect(en?.usable).toBe(true); // installed + STT
    expect(en?.pack).toBe('installed');
    expect(es?.pack).toBe('downloadable');
    expect(es?.usable).toBe(false);
    // Usable rows sort first.
    expect(result.current.usable[0].lang).toBe('en');
  });

  it('downloadPack: downloading → installed after a successful download + re-sync', async () => {
    let downloaded = ['en'];
    const translator = fakeTranslator({
      downloadPack: jest.fn(async () => {
        downloaded = ['en', 'es'];
      }),
      listDownloadedLanguages: jest.fn(async () => downloaded),
    });
    const { result } = setup(translator);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.downloadPack('es', 'en', true);
    });

    expect(translator.downloadPack).toHaveBeenCalledWith('es', 'en', { wifiOnly: true });
    expect(result.current.packs.es).toBe('installed');
  });

  it('downloadPack failure marks the pack downloadable again', async () => {
    const translator = fakeTranslator({
      downloadPack: jest.fn(async () => {
        throw new Error('no wifi');
      }),
    });
    const { result } = setup(translator);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.downloadPack('es', 'en', true);
    });

    expect(result.current.packs.es).toBe('downloadable');
  });
});
