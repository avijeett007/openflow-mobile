/**
 * Engine-biasing + cleanup-prompt helpers shared by the STT clients (L2) and the
 * cleanup prompt assembler (L3). Ported from desktop `backends::stt_http`
 * (`build_prompt_string`, `deepgram_biasing_style`, `deepgram_keyterm_words`)
 * and `actions::dictionary_vocabulary_block`.
 */

import type { DictionaryEntry } from '../settings/schema';
import { dictionaryWords } from './engine';

/**
 * Conservative char budget for the OpenAI-compatible `prompt` field. Whisper /
 * gpt-4o transcription decoders effectively attend only to the prompt tail, so
 * an overlong dictionary is truncated by dropping WHOLE words from the front
 * (see {@link buildPromptString}). The cleanup vocabulary block reuses the same
 * budget so a large dictionary can't blow out the system prompt.
 */
export const OPENAI_PROMPT_MAX_CHARS = 800;
export const VOCABULARY_BLOCK_MAX_CHARS = 800;

/** Deepgram param caps (approximating the documented token limits). */
export const DEEPGRAM_KEYTERM_MAX_COUNT = 500;
export const DEEPGRAM_KEYWORDS_MAX_COUNT = 100;

/**
 * Join `words` into a comma-separated biasing string, tail-truncated to
 * `maxChars` by dropping whole words from the FRONT (the earliest-added,
 * presumptively least-important entries) rather than mid-word char-truncating.
 * Blank words are dropped. Returns `null` for an empty / all-blank list —
 * callers must then send no biasing param at all.
 */
export function buildPromptString(words: string[], maxChars: number): string | null {
  const filtered = words.filter((w) => w.trim().length > 0);
  if (filtered.length === 0) return null;

  const full = filtered.join(', ');
  if (full.length <= maxChars) return full;

  // Keep trailing whole words until adding another would exceed maxChars.
  const kept: string[] = [];
  let len = 0;
  for (let idx = filtered.length - 1; idx >= 0; idx -= 1) {
    const w = filtered[idx] as string;
    const sepLen = kept.length === 0 ? 0 : 2; // ", "
    const candidateLen = len + sepLen + w.length;
    if (candidateLen > maxChars) break;
    len = candidateLen;
    kept.push(w);
  }
  if (kept.length === 0) {
    // Even the single most-important word doesn't fit; send it anyway — the
    // engine truncates internally, which beats sending nothing.
    return filtered[filtered.length - 1] as string;
  }
  kept.reverse();
  return kept.join(', ');
}

/** Deepgram vocabulary-biasing param, chosen by model name (case-insensitive). */
export type DeepgramBiasingStyle = 'keyterm' | 'keywords';

/**
 * Nova-3 / Flux models support Keyterm Prompting (`keyterm`, multi-word OK);
 * every older/legacy model (Nova-2 and earlier, Whisper-Cloud) only understands
 * the legacy `keywords` param (single words).
 */
export function deepgramBiasingStyle(model: string): DeepgramBiasingStyle {
  const m = model.trim().toLowerCase();
  return m.includes('nova-3') || m.includes('flux') ? 'keyterm' : 'keywords';
}

/**
 * Words for Deepgram `keyterm` biasing: canonical `word`s PLUS their
 * `sounds_like` aliases. Unlike the cleanup vocabulary block or the OpenAI
 * `prompt` / legacy `keywords` paths, `keyterm` biases the ASR's own acoustic
 * matching, so surfacing the misheard forms increases the odds Deepgram emits
 * something the correction pass can resolve to the canonical spelling.
 */
export function deepgramKeytermWords(entries: DictionaryEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.word.trim().length > 0) out.push(entry.word);
    for (const alias of entry.sounds_like) {
      if (alias.trim().length > 0) out.push(alias);
    }
  }
  return out;
}

/**
 * The "Vocabulary" block appended to the cleanup system prompt so the LLM keeps
 * the user's exact custom spellings instead of "fixing" them. Canonical `word`s
 * only — `sounds_like` aliases are the forms the user wants replaced AWAY from,
 * so surfacing them to the cleanup model would be self-defeating. Returns `null`
 * for an empty dictionary (callers append nothing).
 */
export function dictionaryVocabularyBlock(entries: DictionaryEntry[]): string | null {
  const joined = buildPromptString(dictionaryWords(entries), VOCABULARY_BLOCK_MAX_CHARS);
  if (joined === null) return null;
  return `Vocabulary — always use these exact spellings of the user's custom words: ${joined}`;
}
