/**
 * langs.ts — BCP-47 juggling between three vocabularies:
 *
 *  1. STT locales     (SFSpeechRecognizer / Android SpeechRecognizer):
 *                     region-qualified, sometimes legacy — `en-US`, `zh-TW`,
 *                     `iw-IL`, `fil-PH`, `nb-NO`, `pt-BR`.
 *  2. ML Kit langs    (Android translation): 59 bare codes, some legacy —
 *                     `he`, `no`, `tl`, single `zh` (Simplified model).
 *  3. Apple langs     (iOS 18 Translation): ~21 codes with real script/region
 *                     variants — `zh-Hans`/`zh-Hant`, `en-GB`/`en-US`, `pt-BR`.
 *
 * Everything here is pure and platform-agnostic: callers pass the platform's
 * own language list (from `listSupportedLanguages()`) and get back codes FROM
 * THAT LIST, never invented ones. Pinned fixtures for both platforms live in
 * ../../fixtures/langs-mlkit.json and langs-apple.json.
 */

import type { PackMap, PackState } from './packs';

// ---- Subtag parsing ---------------------------------------------------------

/** Lowercased primary language subtag of a BCP-47 tag ('' for empty). Tolerates `_`. */
export function bcp47Primary(tag: string): string {
  const first = tag.trim().replace(/_/g, '-').split('-')[0];
  return (first ?? '').toLowerCase();
}

/**
 * Legacy / macrolanguage primary-subtag aliases, canonicalized to ONE spelling
 * so both spellings of a language compare equal:
 * - `iw` → `he`  (Hebrew — old ISO code; some Android STT locales still use iw)
 * - `in` → `id`  (Indonesian — old ISO code)
 * - `ji` → `yi`  (Yiddish — old ISO code)
 * - `tl` → `fil` (Tagalog/Filipino — ML Kit says `tl`, STT locales say `fil-PH`)
 * - `nb` → `no`  (Norwegian Bokmål vs macrolanguage — ML Kit says `no`, STT says `nb-NO`;
 *                 Nynorsk `nn` is intentionally NOT aliased — it is a different written language)
 * - `mo` → `ro`  (Moldavian — deprecated alias of Romanian)
 */
export const PRIMARY_ALIASES: Readonly<Record<string, string>> = {
  iw: 'he',
  in: 'id',
  ji: 'yi',
  tl: 'fil',
  nb: 'no',
  mo: 'ro',
};

/** Canonical (alias-resolved) lowercased primary subtag. */
export function canonicalPrimary(tag: string): string {
  const primary = bcp47Primary(tag);
  return PRIMARY_ALIASES[primary] ?? primary;
}

interface ParsedTag {
  primary: string; // canonical
  script?: string; // lowercased 4-letter script subtag if present
  region?: string; // lowercased 2-letter/3-digit region subtag if present
}

function parseTag(tag: string): ParsedTag {
  const subtags = tag.trim().replace(/_/g, '-').split('-').filter(Boolean);
  const parsed: ParsedTag = { primary: canonicalPrimary(tag) };
  for (const raw of subtags.slice(1)) {
    const s = raw.toLowerCase();
    if (!parsed.script && /^[a-z]{4}$/.test(s)) parsed.script = s;
    else if (!parsed.region && (/^[a-z]{2}$/.test(s) || /^[0-9]{3}$/.test(s))) parsed.region = s;
  }
  return parsed;
}

/** Regions written in Traditional Chinese script. Everything else defaults to Simplified. */
const HANT_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * Effective script for a Chinese tag: explicit script subtag first, else
 * inferred from region (TW/HK/MO → Hant), else Hans. This is how `zh-CN`
 * lines up with Apple's `zh-Hans` and `zh-TW` with `zh-Hant`.
 */
function zhScript(parsed: ParsedTag): 'hans' | 'hant' {
  if (parsed.script === 'hant') return 'hant';
  if (parsed.script === 'hans') return 'hans';
  if (parsed.region && HANT_REGIONS.has(parsed.region)) return 'hant';
  return 'hans';
}

/**
 * Language-level matching key: canonical primary subtag, plus the (explicit or
 * inferred) script for Chinese, where script distinguishes real translation
 * targets. `zh-CN`/`zh-Hans`/`zh` → `zh-hans`; `zh-TW`/`zh-Hant-TW` → `zh-hant`;
 * `iw-IL`/`he` → `he`; `nb-NO`/`no` → `no`; `fil-PH`/`tl` → `fil`.
 */
export function langKey(tag: string): string {
  const parsed = parseTag(tag);
  if (parsed.primary === 'zh') return `zh-${zhScript(parsed)}`;
  return parsed.primary;
}

/** Full matching key: {@link langKey} plus the region subtag when present (`en-US` → `en-us`). */
export function fullLangKey(tag: string): string {
  return fullKey(tag);
}

function fullKey(tag: string): string {
  const parsed = parseTag(tag);
  const base = langKey(tag);
  return parsed.region ? `${base}-${parsed.region}` : base;
}

// ---- STT locale ↔ translation code mapping ---------------------------------

/**
 * Map any BCP-47 tag (typically an STT locale) onto the platform's translation
 * language list, returning the code EXACTLY as it appears in `available`, or
 * `null` when the platform can't translate that language.
 *
 * Three match tiers, most specific first; within a tier the FIRST entry of
 * `available` wins (platform list order is the tie-break, e.g. `en-AU` on
 * Apple → `en-GB` because it precedes `en-US` in the pinned list):
 *  1. full key   (primary+script+region)  `en-US` → Apple `en-US`
 *  2. lang key   (primary+zh-script)      `zh-CN` → Apple `zh-Hans`, ML Kit `zh`
 *  3. primary    (canonical alias)        `zh-TW` → ML Kit `zh`; `pt-PT` → Apple `pt-BR`
 */
export function toTranslationLang(tag: string, available: readonly string[]): string | null {
  if (!bcp47Primary(tag)) return null;
  const want = { full: fullKey(tag), lang: langKey(tag), primary: canonicalPrimary(tag) };
  let langMatch: string | null = null;
  let primaryMatch: string | null = null;
  for (const code of available) {
    if (fullKey(code) === want.full) return code;
    if (langMatch === null && langKey(code) === want.lang) langMatch = code;
    if (primaryMatch === null && canonicalPrimary(code) === want.primary) primaryMatch = code;
  }
  return langMatch ?? primaryMatch;
}

/**
 * Pick the best on-device STT locale for a translation language code, or
 * `null` when the device has no recognizer for it (the "missing STT pack"
 * case — usable-pair logic treats the language as unusable and the UI shows
 * platform-correct install instructions). Same tiers as
 * {@link toTranslationLang}, matched in `sttLocales` order.
 */
export function pickSttLocale(lang: string, sttLocales: readonly string[]): string | null {
  return toTranslationLang(lang, sttLocales);
}

// ---- Display names ----------------------------------------------------------

/**
 * English fallback display names for every code in both pinned platform lists
 * (plus common alias spellings). Used when `Intl.DisplayNames` is missing
 * (older Hermes) — otherwise ICU provides the name.
 */
export const FALLBACK_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  af: 'Afrikaans',
  ar: 'Arabic',
  be: 'Belarusian',
  bg: 'Bulgarian',
  bn: 'Bengali',
  ca: 'Catalan',
  cs: 'Czech',
  cy: 'Welsh',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  'en-gb': 'English (UK)',
  'en-us': 'English (US)',
  eo: 'Esperanto',
  es: 'Spanish',
  et: 'Estonian',
  fa: 'Persian',
  fi: 'Finnish',
  fil: 'Filipino',
  fr: 'French',
  ga: 'Irish',
  gl: 'Galician',
  gu: 'Gujarati',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  ht: 'Haitian Creole',
  hu: 'Hungarian',
  id: 'Indonesian',
  is: 'Icelandic',
  it: 'Italian',
  ja: 'Japanese',
  ka: 'Georgian',
  kn: 'Kannada',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  mk: 'Macedonian',
  mr: 'Marathi',
  ms: 'Malay',
  mt: 'Maltese',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  'pt-br': 'Portuguese (Brazil)',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sq: 'Albanian',
  sv: 'Swedish',
  sw: 'Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  yi: 'Yiddish',
  'zh-hans': 'Chinese (Simplified)',
  'zh-hant': 'Chinese (Traditional)',
};

/**
 * Human-readable (English) name for a language code. Prefers
 * `Intl.DisplayNames` when the runtime has it, falls back to
 * {@link FALLBACK_DISPLAY_NAMES}, ultimately echoes the code.
 */
export function displayLanguageName(code: string): string {
  const normalizedTag = code.trim().replace(/_/g, '-');
  try {
    const DisplayNames = (Intl as { DisplayNames?: typeof Intl.DisplayNames }).DisplayNames;
    if (DisplayNames) {
      const name = new DisplayNames(['en'], { type: 'language' }).of(normalizedTag);
      if (name && name !== normalizedTag) return name;
    }
  } catch {
    // Malformed tag or partial ICU — fall through to the table.
  }
  const fk = fullKey(code);
  const lk = langKey(code);
  return FALLBACK_DISPLAY_NAMES[fk] ?? FALLBACK_DISPLAY_NAMES[lk] ?? code;
}

// ---- Usable-language intersection --------------------------------------------

/** One language-picker row: a platform translation language annotated with STT + pack reality. */
export interface UsableLang {
  /** Translation code exactly as the platform reports it (pass this to translate()). */
  lang: string;
  /** English display name for the picker row. */
  displayName: string;
  /** Best on-device STT locale for this language, or null when none exists. */
  sttLocale: string | null;
  /** False when STT locales could not be enumerated (`sttLocales === null`) — STT treated as unknown, not missing. */
  sttKnown: boolean;
  /** Translation pack state (client-side `downloading` included). */
  pack: PackState;
  /** Ready right now: pack installed AND an STT locale exists (or STT is unknown). */
  usable: boolean;
}

const PACK_RANK: Record<PackState, number> = {
  installed: 0,
  downloading: 1,
  downloadable: 2,
  unsupported: 3,
};

function packStateOf(packStates: PackMap, lang: string): PackState {
  const direct = packStates[lang];
  if (direct) return direct;
  const key = langKey(lang);
  for (const [candidate, state] of Object.entries(packStates)) {
    if (langKey(candidate) === key) return state;
  }
  // The platform listed it as supported; before any pack sync assume a download is needed.
  return 'downloadable';
}

/**
 * The picker list: intersect the platform's translation languages with the
 * device's on-device STT locales and current pack states.
 *
 * - `sttLocales === null` means enumeration is unavailable (e.g. Android
 *   < API 33): STT is treated as UNKNOWN, `usable` falls back to pack state
 *   alone and `sttKnown` is false so the UI can soften its copy.
 * - `downloading` packs are NOT usable yet (spinner row).
 * - Sort: ready-to-use first, then installed-but-no-STT, then downloading,
 *   then downloadable; alphabetical by display name within each group.
 */
export function computeUsable(
  sttLocales: readonly string[] | null,
  translationLangs: readonly string[],
  packStates: PackMap,
): UsableLang[] {
  const sttKnown = sttLocales !== null;
  const rows = translationLangs.map((lang): UsableLang => {
    const sttLocale = sttKnown ? pickSttLocale(lang, sttLocales) : null;
    const pack = packStateOf(packStates, lang);
    const sttOk = sttKnown ? sttLocale !== null : true;
    return {
      lang,
      displayName: displayLanguageName(lang),
      sttLocale,
      sttKnown,
      pack,
      usable: pack === 'installed' && sttOk,
    };
  });
  return rows.sort((a, b) => {
    const rank = (r: UsableLang): number =>
      r.usable ? 0 : r.pack === 'installed' ? 1 : 1 + PACK_RANK[r.pack];
    return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
  });
}
