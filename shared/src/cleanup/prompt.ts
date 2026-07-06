import { defaultPrompt, type DictionaryEntry, type Prompt } from '../settings/schema';
import { dictionaryVocabularyBlock } from '../dictionary';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Resolve the prompt referenced by `promptId` from the supplied list, falling
 * back to the built-in default prompt when not found.
 */
export function resolvePrompt(promptId: string, prompts?: Prompt[]): Prompt {
  const found = prompts?.find((p) => p.id === promptId);
  return found ?? defaultPrompt();
}

/**
 * Assemble the chat messages for a cleanup request: the resolved prompt as the
 * system message, the transcript as the user message.
 *
 * L3 dictionary injection: when `dictionary` is non-empty, a "Vocabulary — always
 * use these exact spellings…" block (canonical words only, ~800-char tail-capped)
 * is appended to the system content so the cleanup LLM keeps the user's custom
 * spellings instead of "fixing" them. Desktop parity: `build_system_prompt`.
 */
export function assembleCleanupMessages(
  promptText: string,
  transcript: string,
  dictionary: DictionaryEntry[] = [],
): ChatMessage[] {
  let system = promptText;
  const block = dictionaryVocabularyBlock(dictionary);
  if (block) {
    system = system ? `${system}\n\n${block}` : block;
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript },
  ];
}
