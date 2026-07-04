import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  type PackMap,
  type TranslationAvailability,
  type TranslatorModuleApi,
  type UsableLang,
  computeUsable,
  initialPackMap,
  packReducer,
} from '@openflow/shared';
import { getSupportedLocalesSafe } from '../lib/localStt';

/**
 * useTranslatorCatalog — loads the device's translation catalogue (availability,
 * supported languages, on-device STT locales, pack states) and drives the
 * `packReducer` (T1) for the language pickers, offline chip, and download flow.
 *
 * All native access is DEFENSIVE (the injected `translator` degrades to
 * empty/`{ available: false }` in Expo Go / Jest), so this hook renders happily
 * with no native module — the pickers simply show nothing usable.
 */

export interface UseTranslatorCatalogOptions {
  translator: TranslatorModuleApi;
  /**
   * Enumerate on-device STT locales. Default: iOS reads the translator module's
   * `sttOnDeviceLocales()`; Android reads `getSupportedLocalesSafe()`. `null`
   * means enumeration is unavailable (STT treated as UNKNOWN, not missing).
   */
  getSttLocales?: () => Promise<string[] | null>;
  /** Platform override for tests. */
  platform?: 'ios' | 'android';
}

export interface TranslatorCatalog {
  loading: boolean;
  availability: TranslationAvailability | null;
  /** Platform translation languages, exactly as reported. */
  supported: string[];
  /** On-device STT locales, or null when enumeration is unavailable. */
  sttLocales: string[] | null;
  packs: PackMap;
  /** Picker rows (usable first, then downloadable) for the given `sttLocales`/packs. */
  usable: UsableLang[];
  /** Re-read supported + downloaded + STT locales from the device. */
  refresh: () => Promise<void>;
  /** Download the translation pack for `lang` (paired with `otherLang` for the pivot). */
  downloadPack: (lang: string, otherLang: string, wifiOnly: boolean) => Promise<void>;
}

async function defaultGetSttLocales(
  translator: TranslatorModuleApi,
  platform: string,
): Promise<string[] | null> {
  if (platform === 'ios') {
    return translator.sttOnDeviceLocales();
  }
  const res = await getSupportedLocalesSafe();
  if (!res) return null;
  // Installed models are the truly offline-ready set; fall back to the full
  // supported list when the service doesn't report installed locales.
  return res.installedLocales.length > 0 ? res.installedLocales : res.locales;
}

export function useTranslatorCatalog(options: UseTranslatorCatalogOptions): TranslatorCatalog {
  const { translator } = options;
  const platform = options.platform ?? Platform.OS;
  const getSttLocales = options.getSttLocales;

  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<TranslationAvailability | null>(null);
  const [supported, setSupported] = useState<string[]>([]);
  const [sttLocales, setSttLocales] = useState<string[] | null>(null);
  const [packs, dispatchPacks] = useReducer(packReducer, initialPackMap);

  // Keep collaborators in refs so `refresh` stays stable across renders even
  // when a caller passes an inline (identity-changing) `getSttLocales`/translator
  // — otherwise the mount effect would re-fire on every render.
  const translatorRef = useRef(translator);
  translatorRef.current = translator;
  const getSttLocalesRef = useRef(getSttLocales);
  getSttLocalesRef.current = getSttLocales;

  const refresh = useCallback(async (): Promise<void> => {
    const t = translatorRef.current;
    const loadLocales = getSttLocalesRef.current ?? (() => defaultGetSttLocales(t, platform));
    const [avail, supportedLangs, downloaded, locales] = await Promise.all([
      t.isTranslationAvailable(),
      t.listSupportedLanguages(),
      t.listDownloadedLanguages(),
      loadLocales(),
    ]);
    setAvailability(avail);
    setSupported(supportedLangs);
    setSttLocales(locales);
    dispatchPacks({ type: 'SYNC', supported: supportedLangs, downloaded });
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const downloadPack = useCallback(
    async (lang: string, otherLang: string, wifiOnly: boolean): Promise<void> => {
      const t = translatorRef.current;
      dispatchPacks({ type: 'DOWNLOAD_START', lang });
      try {
        await t.downloadPack(lang, otherLang, { wifiOnly });
        // Re-read the on-device model list so the row flips to 'installed'.
        const downloaded = await t.listDownloadedLanguages();
        dispatchPacks({ type: 'SYNC', supported, downloaded });
        dispatchPacks({ type: 'DOWNLOAD_DONE', lang });
      } catch {
        dispatchPacks({ type: 'DOWNLOAD_FAILED', lang });
      }
    },
    [supported],
  );

  const usable = useMemo(
    () => computeUsable(sttLocales, supported, packs),
    [sttLocales, supported, packs],
  );

  return {
    loading,
    availability,
    supported,
    sttLocales,
    packs,
    usable,
    refresh,
    downloadPack,
  };
}
