/**
 * Dictionary correction engine — a behavioral TS port of the desktop OpenFlow
 * engine (`apply_dictionary` / `apply_dictionary_aliases_only` in
 * src-tauri/src/audio_toolkit/text.rs, shipped in v0.10.0). Import/export JSON
 * round-trips between the two apps, so this matches the desktop semantics — not
 * its code style.
 *
 * Two passes run left-to-right, greedy longest-match first:
 *
 *  1. **Deterministic exact-alias replacement** — any n-gram exactly matching an
 *     entry's `sounds_like` alias is rewritten to the canonical `word`. This is
 *     threshold-independent (homophone rules always fire) and the replaced span
 *     is LOCKED so pass 2 can neither re-edit it nor span across it.
 *  2. **Fuzzy correction** — normalized Levenshtein distance + a Soundex phonetic
 *     boost over canonical words AND aliases (an alias hit yields the canonical
 *     word), across 1–3-word n-grams, gated by `threshold` (default 0.18) and a
 *     25%-length guard. Entries flagged `replace_exact` skip this pass entirely.
 *
 * Hardening carried over from desktop (all learned the hard way):
 *  - edge-trim guard: a multi-word span only wins if it scores STRICTLY better
 *    than its drop-leading and drop-trailing sub-spans against the same target,
 *    so a greedy n-gram can't silently swallow an adjacent function word;
 *  - a fuzzy n-gram may not span internal punctuation (leading punctuation on a
 *    non-first word / trailing on a non-last word marks a phrase break);
 *  - punctuation prefix/suffix and input case-pattern are preserved, unless the
 *    entry is `case_sensitive` (then `word` is emitted verbatim);
 *  - unicode-safe throughout: every character operation works on code points
 *    (spread / `Array.from`), never UTF-16 units or bytes.
 */

import type { DictionaryEntry } from '../settings/schema';
import { soundex } from './soundex';

/** Fuzzy acceptance threshold used by the desktop default. */
export const DEFAULT_DICTIONARY_THRESHOLD = 0.18;

// ---- Unicode-safe primitives ----------------------------------------------

/** Whether a single code point is a letter or number (Unicode-aware). */
function isAlnum(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Whether a single code point is a cased character in its uppercase form. */
function isUpperChar(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase() && ch === ch.toUpperCase();
}

/** Split on Unicode whitespace, dropping empty fragments (like `split_whitespace`). */
function splitWords(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0);
}

/** Trim leading/trailing non-alphanumeric code points from a word. */
function trimNonAlnum(word: string): string {
  const cps = [...word];
  let start = 0;
  let end = cps.length;
  while (start < end && !isAlnum(cps[start] as string)) start += 1;
  while (end > start && !isAlnum(cps[end - 1] as string)) end -= 1;
  return cps.slice(start, end).join('');
}

/**
 * Split a word into its leading punctuation, and trailing punctuation. Operates
 * on code points so multi-byte marks (¿ ¡ « » 「 」 …) never split mid-character.
 * Mirrors desktop `extract_punctuation` (an all-punctuation token yields the
 * whole word as both prefix and suffix — such tokens never match anyway).
 */
function extractPunctuation(word: string): [string, string] {
  const cps = [...word];
  let prefixEnd = 0;
  for (let i = 0; i < cps.length; i += 1) {
    if (isAlnum(cps[i] as string)) break;
    prefixEnd = i + 1;
  }
  let suffixStart = cps.length;
  for (let i = cps.length - 1; i >= 0; i -= 1) {
    if (isAlnum(cps[i] as string)) break;
    suffixStart = i;
  }
  const prefix = prefixEnd > 0 ? cps.slice(0, prefixEnd).join('') : '';
  const suffix = suffixStart < cps.length ? cps.slice(suffixStart).join('') : '';
  return [prefix, suffix];
}

/**
 * Build an n-gram comparison string: strip each word's edge punctuation,
 * lowercase, and concatenate with no separator. Lets "Charge B" match
 * "chargebee".
 */
function buildNgram(words: string[]): string {
  return words.map((w) => trimNonAlnum(w).toLowerCase()).join('');
}

/** Normalize one word for exact-alias comparison. */
function normalizeToken(word: string, caseSensitive: boolean): string {
  const trimmed = trimNonAlnum(word);
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

/** Preserve the original token's case pattern when applying a replacement. */
function preserveCasePattern(original: string, replacement: string): string {
  const chars = [...original];
  if (chars.length > 0 && chars.every((c) => isUpperChar(c))) {
    return replacement.toUpperCase();
  }
  if (chars.length > 0 && isUpperChar(chars[0] as string)) {
    const rep = [...replacement];
    if (rep.length > 0) {
      rep[0] = (rep[0] as string).toUpperCase();
    }
    return rep.join('');
  }
  return replacement;
}

/** Levenshtein edit distance over code points. */
function levenshtein(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Single rolling row of edit distances. `noUncheckedIndexedAccess` types array
  // reads as `number | undefined`, so the hot loop uses `!` — bounds are proven
  // by construction (indices stay within `0..=n`).
  const row = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prevDiag = row[0]!; // distance for (i-1, j-1) before this cell is written
    row[0] = i;
    const si = s[i - 1];
    for (let j = 1; j <= n; j += 1) {
      const above = row[j]!; // (i-1, j)
      const cost = si === t[j - 1] ? 0 : 1;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, prevDiag + cost);
      prevDiag = above;
    }
  }
  return row[n]!;
}

// ---- Precomputed matchers / targets ---------------------------------------

interface AliasMatcher {
  /** Normalized alias tokens; length drives greedy longest-match selection. */
  tokens: string[];
  canonical: string;
  caseSensitive: boolean;
}

interface FuzzyTarget {
  /** Lowercased, space-stripped comparison form (matches `buildNgram` output). */
  compare: string;
  canonical: string;
  caseSensitive: boolean;
}

function buildAliasMatchers(entries: DictionaryEntry[]): AliasMatcher[] {
  const matchers: AliasMatcher[] = [];
  for (const entry of entries) {
    for (const alias of entry.sounds_like) {
      const tokens = splitWords(alias)
        .map((w) => normalizeToken(w, entry.case_sensitive))
        .filter((tok) => tok.length > 0);
      if (tokens.length === 0) continue;
      matchers.push({ tokens, canonical: entry.word, caseSensitive: entry.case_sensitive });
    }
  }
  return matchers;
}

function buildFuzzyTargets(entries: DictionaryEntry[]): FuzzyTarget[] {
  const targets: FuzzyTarget[] = [];
  for (const entry of entries) {
    if (entry.replace_exact) continue;
    const canonicalCmp = entry.word.toLowerCase().replace(/ /gu, '');
    if (canonicalCmp.length > 0) {
      targets.push({
        compare: canonicalCmp,
        canonical: entry.word,
        caseSensitive: entry.case_sensitive,
      });
    }
    for (const alias of entry.sounds_like) {
      const aliasCmp = alias.toLowerCase().replace(/ /gu, '');
      if (aliasCmp.length > 0) {
        targets.push({
          compare: aliasCmp,
          canonical: entry.word,
          caseSensitive: entry.case_sensitive,
        });
      }
    }
  }
  return targets;
}

/** Greedy longest exact-alias match anchored at the start of `words`. */
function matchExactAlias(
  words: string[],
  matchers: AliasMatcher[],
): { n: number; matcher: AliasMatcher } | null {
  let best: { n: number; matcher: AliasMatcher } | null = null;
  for (const matcher of matchers) {
    const n = matcher.tokens.length;
    if (n > words.length) continue;
    let allMatch = true;
    for (let k = 0; k < n; k += 1) {
      if (normalizeToken(words[k] as string, matcher.caseSensitive) !== matcher.tokens[k]) {
        allMatch = false;
        break;
      }
    }
    if (!allMatch) continue;
    if (best === null || n > best.n) {
      best = { n, matcher };
    }
  }
  return best;
}

/** Levenshtein + Soundex score of a candidate against one target (lower = better). */
function scoreAgainstTarget(candidate: string, target: FuzzyTarget): number {
  const candLen = [...candidate].length;
  const compare = target.compare;
  const cmpLen = [...compare].length;
  const maxLen = Math.max(candLen, cmpLen);
  if (maxLen === 0) return 1.0;
  const levScore = levenshtein(candidate, compare) / maxLen;
  return soundex(candidate, compare) ? levScore * 0.3 : levScore;
}

/** Best fuzzy target for a candidate n-gram, subject to threshold + length guard. */
function findBestFuzzy(
  candidate: string,
  targets: FuzzyTarget[],
  threshold: number,
): { target: FuzzyTarget; score: number } | null {
  // Code-point count, not UTF-16 length — a non-ASCII word ("café") must gate on
  // its real size so the 25% length-diff budget below stays correct.
  const candLen = [...candidate].length;
  if (candidate.length === 0 || candLen > 50) return null;

  let best: { target: FuzzyTarget; score: number } | null = null;
  let bestScore = Number.MAX_VALUE;

  for (const target of targets) {
    const cmpLen = [...target.compare].length;
    const lenDiff = Math.abs(candLen - cmpLen);
    const maxLen = Math.max(candLen, cmpLen);
    const maxAllowedDiff = Math.max(maxLen * 0.25, 2.0);
    if (lenDiff > maxAllowedDiff) continue;

    const score = scoreAgainstTarget(candidate, target);
    if (score < threshold && score < bestScore) {
      best = { target, score };
      bestScore = score;
    }
  }
  return best;
}

// ---- Two-pass driver ------------------------------------------------------

interface Stage1Token {
  /** Locked tokens are exact-alias results: immune to and un-spannable by pass 2. */
  locked: boolean;
  text: string;
}

function applyDictionaryInner(
  text: string,
  entries: DictionaryEntry[],
  threshold: number,
  fuzzyEnabled: boolean,
): string {
  if (entries.length === 0) return text;

  const aliasMatchers = buildAliasMatchers(entries);
  const words = splitWords(text);

  // Pass 1: deterministic exact-alias replacement, greedy longest-match.
  const stage1: Stage1Token[] = [];
  let i = 0;
  while (i < words.length) {
    const hit = matchExactAlias(words.slice(i), aliasMatchers);
    if (hit) {
      const { n, matcher } = hit;
      const ngramWords = words.slice(i, i + n);
      const [prefix] = extractPunctuation(ngramWords[0] as string);
      const [, suffix] = extractPunctuation(ngramWords[n - 1] as string);
      const corrected = matcher.caseSensitive
        ? matcher.canonical
        : preserveCasePattern(ngramWords[0] as string, matcher.canonical);
      stage1.push({ locked: true, text: `${prefix}${corrected}${suffix}` });
      i += n;
    } else {
      stage1.push({ locked: false, text: words[i] as string });
      i += 1;
    }
  }

  if (!fuzzyEnabled) {
    return stage1.map((t) => t.text).join(' ');
  }

  const fuzzyTargets = buildFuzzyTargets(entries);

  // Pass 2: fuzzy correction over canonical words + aliases (greedy n-grams),
  // skipping locked tokens entirely.
  const result: string[] = [];
  i = 0;
  while (i < stage1.length) {
    const tok = stage1[i] as Stage1Token;
    if (tok.locked) {
      result.push(tok.text);
      i += 1;
      continue;
    }

    let matched = false;
    for (let n = 3; n >= 1; n -= 1) {
      if (i + n > stage1.length) continue;
      const span = stage1.slice(i, i + n);
      // An n-gram may not span a locked (already-resolved) token.
      if (span.some((t) => t.locked)) continue;
      const ngramWords = span.map((t) => t.text);

      // A fuzzy n-gram must not span an internal punctuation boundary (leading
      // punctuation on a non-first word / trailing on a non-last word). Without
      // this, "Charge B, che" fuses into "chargebche" and swallows "che".
      let spansInternalPunct = false;
      for (let k = 0; k < n; k += 1) {
        const [prefix, suffix] = extractPunctuation(ngramWords[k] as string);
        if ((k > 0 && prefix !== '') || (k + 1 < n && suffix !== '')) {
          spansInternalPunct = true;
          break;
        }
      }
      if (spansInternalPunct) continue;

      const ngram = buildNgram(ngramWords);
      const found = findBestFuzzy(ngram, fuzzyTargets, threshold);
      if (found) {
        const { target, score } = found;
        // Edge-trim guard: a multi-word span must not win if dropping its
        // leading or trailing word scores no worse against the SAME target —
        // that edge word is being absorbed "for free" and silently deleted.
        if (n > 1) {
          const dropLeading = buildNgram(ngramWords.slice(1));
          const dropTrailing = buildNgram(ngramWords.slice(0, n - 1));
          if (
            scoreAgainstTarget(dropLeading, target) <= score ||
            scoreAgainstTarget(dropTrailing, target) <= score
          ) {
            continue;
          }
        }

        const [prefix] = extractPunctuation(ngramWords[0] as string);
        const [, suffix] = extractPunctuation(ngramWords[n - 1] as string);
        const corrected = target.caseSensitive
          ? target.canonical
          : preserveCasePattern(ngramWords[0] as string, target.canonical);
        result.push(`${prefix}${corrected}${suffix}`);
        i += n;
        matched = true;
        break;
      }
    }

    if (!matched) {
      result.push(tok.text);
      i += 1;
    }
  }

  return result.join(' ');
}

// ---- Public API -----------------------------------------------------------

/**
 * Apply dictionary corrections to `text`: deterministic exact-alias replacement
 * followed by fuzzy correction (Levenshtein + Soundex). `threshold` is the
 * maximum fuzzy score accepted (default {@link DEFAULT_DICTIONARY_THRESHOLD};
 * `0` disables fuzzy, exact aliases still fire).
 */
export function applyDictionary(
  text: string,
  entries: DictionaryEntry[],
  threshold: number = DEFAULT_DICTIONARY_THRESHOLD,
): string {
  return applyDictionaryInner(text, entries, threshold, true);
}

/**
 * Deterministic exact-alias replacement only — the fuzzy pass is disabled. Used
 * on engine-prompted paths (the STT engine was already biased with the canonical
 * words, so fuzzy correction is redundant) where explicit `sounds_like` alias
 * rules must still be enforced. Desktop parity: `apply_dictionary_aliases_only`.
 */
export function applyDictionaryAliasesOnly(text: string, entries: DictionaryEntry[]): string {
  return applyDictionaryInner(text, entries, 0.0, false);
}

/** Canonical words of the dictionary (non-blank), for biasing / cleanup callers. */
export function dictionaryWords(entries: DictionaryEntry[]): string[] {
  return entries.map((e) => e.word).filter((w) => w.trim().length > 0);
}

/**
 * Correct a transcript against the dictionary, choosing the pass by whether the
 * STT engine was already biased with the words: `prompted` → aliases-only (skip
 * the redundant fuzzy pass, desktop parity); otherwise the full two-pass
 * correction. A no-op for an empty dictionary.
 */
export function correctTranscript(
  text: string,
  entries: DictionaryEntry[],
  prompted: boolean,
  threshold: number = DEFAULT_DICTIONARY_THRESHOLD,
): string {
  if (entries.length === 0) return text;
  return prompted
    ? applyDictionaryAliasesOnly(text, entries)
    : applyDictionary(text, entries, threshold);
}
