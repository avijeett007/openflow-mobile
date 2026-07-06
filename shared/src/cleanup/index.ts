import { ConfigError, throwForResponse, EndpointError } from '../errors';
import type { CleanupProvider, CleanupSettings, DictionaryEntry, Prompt } from '../settings/schema';
import { assembleCleanupMessages, resolvePrompt } from './prompt';

export * from './prompt';

export interface CleanupOptions {
  settings: CleanupSettings;
  transcript: string;
  /** Resolved secret; may be empty for keyless providers (e.g. Ollama). */
  apiKey: string;
  /** Prompt list used to resolve `settings.promptId`; defaults to the built-in. */
  prompts?: Prompt[];
  /**
   * Dictionary entries — when non-empty, a "Vocabulary" block is appended to the
   * cleanup system prompt (L3) so the LLM keeps the user's exact spellings.
   */
  dictionary?: DictionaryEntry[];
  /** Injectable fetch for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface CleanupResult {
  text: string;
}

/** Default OpenAI-compatible chat base URLs (each already includes `/v1`). */
const CHAT_BASE: Partial<Record<CleanupProvider, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveChatBase(settings: CleanupSettings): string {
  if (settings.provider === 'custom') {
    if (!settings.baseUrl) {
      throw new ConfigError('Cleanup provider "custom" requires a baseUrl.');
    }
    return stripTrailingSlash(settings.baseUrl);
  }
  const base = settings.baseUrl ?? CHAT_BASE[settings.provider];
  if (!base) {
    throw new ConfigError(`No base URL configured for cleanup provider "${settings.provider}".`);
  }
  return stripTrailingSlash(base);
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

/**
 * Clean a raw transcript through an OpenAI-compatible `/chat/completions`
 * endpoint (Groq / OpenAI / OpenRouter / custom / Ollama).
 *
 * The caller decides the fallback policy — on any failure this throws a typed
 * error (never silently returns the raw transcript).
 *
 * @throws {@link AuthError} on 401/403, {@link EndpointError} on other HTTP
 *   failures or malformed responses, {@link ConfigError} on invalid settings.
 */
export async function cleanTranscript(opts: CleanupOptions): Promise<CleanupResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = resolveChatBase(opts.settings);
  const url = `${base}/chat/completions`;

  const prompt = resolvePrompt(opts.settings.promptId, opts.prompts);
  const messages = assembleCleanupMessages(prompt.prompt, opts.transcript, opts.dictionary);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Ollama (and other keyless custom endpoints) may run without a key.
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }

  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.settings.model,
      messages,
      temperature: 0.2,
      stream: false,
    }),
  });

  if (!res.ok) {
    await throwForResponse(res, 'Cleanup');
  }

  const json = (await res.json().catch(() => null)) as ChatCompletionResponse | null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new EndpointError('Cleanup: response missing choices[0].message.content', res.status);
  }
  return { text: content.trim() };
}
