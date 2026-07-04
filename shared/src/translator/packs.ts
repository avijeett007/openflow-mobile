/**
 * packs.ts — pure client-side tracker for translation language packs.
 *
 * The native module only knows three per-pair states
 * ({@link import('./module').PairStatus}); this reducer adds the client-side
 * `downloading` state so the UI can show progress rows, and survives re-syncs
 * from `listSupportedLanguages()` / `listDownloadedLanguages()` without losing
 * in-flight downloads.
 */

import { fullLangKey, langKey } from './langs';

/** Per-LANGUAGE pack state as the UI tracks it. */
export type PackState = 'installed' | 'downloadable' | 'downloading' | 'unsupported';

/** Runtime list of {@link PackState} values (for zod enums / UI switches). */
export const PACK_STATES = ['installed', 'downloadable', 'downloading', 'unsupported'] as const;

/** Language code (as reported by the platform) → pack state. */
export type PackMap = Readonly<Record<string, PackState>>;

export const initialPackMap: PackMap = {};

export type PackAction =
  /** Rebuild from the module's lists (keys become `supported`'s exact codes). */
  | { type: 'SYNC'; supported: string[]; downloaded: string[] }
  | { type: 'DOWNLOAD_START'; lang: string }
  | { type: 'DOWNLOAD_DONE'; lang: string }
  | { type: 'DOWNLOAD_FAILED'; lang: string }
  | { type: 'PACK_DELETED'; lang: string };

/** Resolve a language to its key in `state`, tolerating alias spellings (iw/he, nb/no, tl/fil, zh variants). */
function resolveKey(state: PackMap, lang: string): string | null {
  if (lang in state) return lang;
  const key = langKey(lang);
  for (const candidate of Object.keys(state)) {
    if (langKey(candidate) === key) return candidate;
  }
  return null;
}

/** Pack state for `lang` with alias-tolerant lookup; unknown languages are `unsupported`. */
export function getPackState(state: PackMap, lang: string): PackState {
  const key = resolveKey(state, lang);
  return key === null ? 'unsupported' : (state[key] ?? 'unsupported');
}

function withState(state: PackMap, lang: string, next: PackState): PackMap {
  const key = resolveKey(state, lang);
  if (key === null) return state;
  if (state[key] === next) return state;
  return { ...state, [key]: next };
}

export function packReducer(state: PackMap, action: PackAction): PackMap {
  switch (action.type) {
    case 'SYNC': {
      // Two-tier downloaded↔supported matching:
      //  1. exact full key (region-aware) — keeps Apple's en-GB vs en-US and
      //     zh-Hans vs zh-Hant packs distinct;
      //  2. alias-tolerant language key (iw↔he, nb-NO↔no, fil↔tl), but ONLY
      //     when that language key is unambiguous among the supported codes,
      //     so region folding can never mark a sibling variant installed.
      const downloadedFull = new Set(action.downloaded.map(fullLangKey));
      const downloadedLang = new Set(action.downloaded.map(langKey));
      const langKeyCounts = new Map<string, number>();
      for (const lang of action.supported) {
        const key = langKey(lang);
        langKeyCounts.set(key, (langKeyCounts.get(key) ?? 0) + 1);
      }
      const isDownloaded = (lang: string): boolean =>
        downloadedFull.has(fullLangKey(lang)) ||
        (langKeyCounts.get(langKey(lang)) === 1 && downloadedLang.has(langKey(lang)));

      const next: Record<string, PackState> = {};
      for (const lang of action.supported) {
        if (isDownloaded(lang)) next[lang] = 'installed';
        // Preserve an in-flight download across a re-sync (alias-tolerant).
        else if (getPackState(state, lang) === 'downloading') next[lang] = 'downloading';
        else next[lang] = 'downloadable';
      }
      return next;
    }
    case 'DOWNLOAD_START':
      // Only a downloadable pack can start downloading (installed stays installed;
      // unsupported / unknown languages are ignored).
      return getPackState(state, action.lang) === 'downloadable'
        ? withState(state, action.lang, 'downloading')
        : state;
    case 'DOWNLOAD_DONE':
      // Trust the platform: whatever we thought, the model is on-device now.
      // (Unknown key — e.g. DONE racing a SYNC that dropped it — is a no-op.)
      return withState(state, action.lang, 'installed');
    case 'DOWNLOAD_FAILED':
      return getPackState(state, action.lang) === 'downloading'
        ? withState(state, action.lang, 'downloadable')
        : state;
    case 'PACK_DELETED':
      return getPackState(state, action.lang) === 'installed'
        ? withState(state, action.lang, 'downloadable')
        : state;
    default: {
      const _never: never = action;
      return _never;
    }
  }
}
