import { type DictionaryEntry, DictionaryEntrySchema } from '@openflow/shared';

/**
 * Pure, RN-free helpers for the Dictionary settings screen (M3a): add/remove/
 * update a `DictionaryEntry` list, parse desktop-compatible import payloads,
 * and merge an imported list into the existing one. Kept dependency-free so
 * the list/add/delete/duplicate/import/merge logic is unit-testable without
 * rendering the screen.
 */

/** Case-insensitive dedupe key for a dictionary word. */
export function normalizeWordKey(word: string): string {
  return word.trim().toLowerCase();
}

/** Trim aliases and drop any that are blank after trimming. */
export function trimAliases(aliases: string[]): string[] {
  return aliases.map((a) => a.trim()).filter((a) => a.length > 0);
}

/** Split a comma-separated aliases input field into a trimmed alias list. */
export function parseAliasInput(text: string): string[] {
  return trimAliases(text.split(','));
}

export interface NewEntryDraft {
  word: string;
  aliases: string[];
  replace_exact?: boolean;
  case_sensitive?: boolean;
}

export type AddEntryError = 'empty-word' | 'duplicate-word';

export interface AddEntryResult {
  entries: DictionaryEntry[];
  error?: AddEntryError;
}

/** True if `word` (case-insensitively) already exists in `entries`. */
export function isDuplicateWord(
  entries: DictionaryEntry[],
  word: string,
  excludeIndex?: number,
): boolean {
  const key = normalizeWordKey(word);
  return entries.some((e, i) => i !== excludeIndex && normalizeWordKey(e.word) === key);
}

/**
 * Add a new entry to `entries`. Validates: trims the word, blocks an empty
 * word, and blocks a case-insensitive duplicate. Returns the ORIGINAL array
 * (unchanged) plus an `error` when validation fails — never throws.
 */
export function addDictionaryEntry(
  entries: DictionaryEntry[],
  draft: NewEntryDraft,
): AddEntryResult {
  const word = draft.word.trim();
  if (word === '') return { entries, error: 'empty-word' };
  if (isDuplicateWord(entries, word)) return { entries, error: 'duplicate-word' };

  const entry: DictionaryEntry = {
    word,
    sounds_like: trimAliases(draft.aliases),
    replace_exact: draft.replace_exact ?? false,
    case_sensitive: draft.case_sensitive ?? false,
  };
  return { entries: [...entries, entry] };
}

/** Remove the entry at `index`. */
export function removeDictionaryEntry(
  entries: DictionaryEntry[],
  index: number,
): DictionaryEntry[] {
  return entries.filter((_, i) => i !== index);
}

/** Patch the entry at `index` (e.g. toggling `case_sensitive` / `replace_exact`). */
export function updateDictionaryEntry(
  entries: DictionaryEntry[],
  index: number,
  patch: Partial<DictionaryEntry>,
): DictionaryEntry[] {
  return entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
}

// ---- Import ------------------------------------------------------------

/** A word/phrase with no aliases and default flags. */
function bareEntry(word: string): DictionaryEntry {
  return { word, sounds_like: [], replace_exact: false, case_sensitive: false };
}

export interface ParsedImport {
  entries: DictionaryEntry[];
  /** Items present in the payload that could not be parsed as a valid entry. */
  skipped: number;
}

/**
 * Parse an import payload. Accepts, in order of preference:
 *  - a JSON array of `DictionaryEntry` objects (desktop OpenFlow export shape)
 *  - a JSON array of plain strings (word-only)
 *  - a `{ dictionary: [...] }` wrapper around either of the above
 *  - a plain newline- and/or comma-separated word list (non-JSON text)
 *
 * Never throws — invalid JSON falls back to the plain-text word-list parse,
 * and individual malformed array items are counted in `skipped` rather than
 * failing the whole import.
 */
export function parseImportedDictionary(text: string): ParsedImport {
  const trimmed = text.trim();
  if (trimmed === '') return { entries: [], skipped: 0 };

  try {
    const json: unknown = JSON.parse(trimmed);
    const parsed = parseJsonDictionary(json);
    if (parsed) return parsed;
  } catch {
    // Not JSON — fall through to the plain-text word-list parse below.
  }

  const words = trimmed
    .split(/[\n,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  return { entries: words.map(bareEntry), skipped: 0 };
}

/** Parse a JSON value already known to be valid JSON. Returns `null` if the shape is unrecognized. */
function parseJsonDictionary(json: unknown): ParsedImport | null {
  let list: unknown[];
  if (Array.isArray(json)) {
    list = json;
  } else if (
    json !== null &&
    typeof json === 'object' &&
    Array.isArray((json as { dictionary?: unknown }).dictionary)
  ) {
    list = (json as { dictionary: unknown[] }).dictionary;
  } else {
    return null;
  }

  const entries: DictionaryEntry[] = [];
  let skipped = 0;
  for (const item of list) {
    if (typeof item === 'string') {
      const word = item.trim();
      if (word) entries.push(bareEntry(word));
      else skipped += 1;
      continue;
    }
    const result = DictionaryEntrySchema.safeParse(item);
    if (result.success) entries.push(result.data);
    else skipped += 1;
  }
  return { entries, skipped };
}

/**
 * Merge `imported` into `existing`, matching by word case-insensitively.
 * Imported entries WIN on conflict (full overwrite of that entry, including
 * aliases/flags). Preserves `existing`'s original ordering; new words from
 * `imported` are appended in their import order.
 */
export function mergeDictionaries(
  existing: DictionaryEntry[],
  imported: DictionaryEntry[],
): DictionaryEntry[] {
  const byKey = new Map<string, DictionaryEntry>();
  for (const e of existing) byKey.set(normalizeWordKey(e.word), e);
  for (const e of imported) byKey.set(normalizeWordKey(e.word), e);

  const order: string[] = [];
  const seen = new Set<string>();
  for (const e of [...existing, ...imported]) {
    const key = normalizeWordKey(e.word);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  return order.map((key) => byKey.get(key) as DictionaryEntry);
}

/** Desktop-compatible export payload: a plain JSON array of entries. */
export function exportDictionaryJson(entries: DictionaryEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
