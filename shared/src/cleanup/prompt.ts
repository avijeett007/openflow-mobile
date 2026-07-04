import { defaultPrompt, type Prompt } from '../settings/schema';

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
 */
export function assembleCleanupMessages(promptText: string, transcript: string): ChatMessage[] {
  return [
    { role: 'system', content: promptText },
    { role: 'user', content: transcript },
  ];
}
