/**
 * `@openflow/shared` dictionary module — custom vocabulary / word replacements.
 *
 * The correction engine (`applyDictionary` / `applyDictionaryAliasesOnly`) is a
 * behavioral port of desktop OpenFlow v0.10.0; the biasing helpers feed the STT
 * clients (L2) and cleanup prompt (L3). See ./engine.ts for the full contract.
 */

export {
  applyDictionary,
  applyDictionaryAliasesOnly,
  correctTranscript,
  dictionaryWords,
  DEFAULT_DICTIONARY_THRESHOLD,
} from './engine';

export { soundex } from './soundex';

export {
  buildPromptString,
  deepgramBiasingStyle,
  deepgramKeytermWords,
  dictionaryVocabularyBlock,
  OPENAI_PROMPT_MAX_CHARS,
  VOCABULARY_BLOCK_MAX_CHARS,
  DEEPGRAM_KEYTERM_MAX_COUNT,
  DEEPGRAM_KEYWORDS_MAX_COUNT,
} from './biasing';
export type { DeepgramBiasingStyle } from './biasing';
