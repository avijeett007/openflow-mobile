import { ConfigError, throwForResponse, EndpointError } from '../errors';
import type { DictionaryEntry, SttProvider, SttSettings } from '../settings/schema';
import {
  buildPromptString,
  deepgramBiasingStyle,
  deepgramKeytermWords,
  dictionaryWords,
  OPENAI_PROMPT_MAX_CHARS,
  DEEPGRAM_KEYTERM_MAX_COUNT,
  DEEPGRAM_KEYWORDS_MAX_COUNT,
} from '../dictionary';

/** Audio clip to transcribe. */
export interface SttAudio {
  bytes: Uint8Array;
  /** e.g. `audio/m4a`, `audio/wav`, `audio/mpeg`. */
  mimeType: string;
  /** File name sent in the multipart part, e.g. `audio.m4a`. */
  fileName: string;
}

export interface TranscribeOptions {
  settings: SttSettings;
  audio: SttAudio;
  /** Resolved secret (looked up from secure storage by the caller). */
  apiKey: string;
  /**
   * Dictionary entries used to bias the engine (L2): the OpenAI-compatible
   * `prompt` field, or Deepgram `keyterm`/`keywords` params. Optional — omit or
   * pass `[]` to send no biasing. Post-STT text correction (L1) is a separate
   * step the caller runs on {@link TranscribeResult.text}.
   */
  dictionary?: DictionaryEntry[];
  /** Injectable fetch for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface TranscribeResult {
  text: string;
  /**
   * Whether vocabulary biasing was actually sent to the engine. Lets the caller
   * pick the right post-STT correction pass: `true` → aliases-only (the engine
   * was already biased with the words, so skip the redundant fuzzy pass);
   * `false` → full `applyDictionary`. Always `false` for an empty dictionary.
   */
  prompted: boolean;
}

/** Default OpenAI-compatible base URLs (each already includes the `/v1` root). */
const OPENAI_COMPAT_BASE: Partial<Record<SttProvider, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
};

const DEEPGRAM_DEFAULT_BASE = 'https://api.deepgram.com';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Resolve the OpenAI-compatible base URL for a non-Deepgram provider. */
function resolveOpenAiBase(settings: SttSettings): string {
  if (settings.provider === 'custom') {
    if (!settings.baseUrl) {
      throw new ConfigError('STT provider "custom" requires a baseUrl.');
    }
    return stripTrailingSlash(settings.baseUrl);
  }
  const base = settings.baseUrl ?? OPENAI_COMPAT_BASE[settings.provider];
  if (!base) {
    throw new ConfigError(`No base URL configured for STT provider "${settings.provider}".`);
  }
  return stripTrailingSlash(base);
}

/**
 * Transcribe an audio clip. Dispatches to the OpenAI-compatible multipart
 * endpoint (Groq / OpenAI / custom) or the Deepgram batch adapter.
 *
 * @throws {@link AuthError} on 401/403, {@link EndpointError} on other HTTP
 *   failures or malformed responses, {@link ConfigError} on invalid settings.
 */
export async function transcribe(opts: TranscribeOptions): Promise<TranscribeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (opts.settings.provider === 'deepgram') {
    return transcribeDeepgram(opts, fetchImpl);
  }
  return transcribeOpenAiCompatible(opts, fetchImpl);
}

async function transcribeOpenAiCompatible(
  opts: TranscribeOptions,
  fetchImpl: typeof fetch,
): Promise<TranscribeResult> {
  const base = resolveOpenAiBase(opts.settings);
  const url = `${base}/audio/transcriptions`;

  const form = new FormData();
  const blob = new Blob([opts.audio.bytes], { type: opts.audio.mimeType });
  form.append('file', blob, opts.audio.fileName);
  form.append('model', opts.settings.model);
  form.append('response_format', 'json');

  // L2 biasing: whisper-1, gpt-4o-transcribe, Groq whisper-large-v3(-turbo) and
  // OpenAI-compatible self-hosted servers all accept a free-text `prompt`; it is
  // harmless if the server ignores it. Canonical words only, tail-truncated.
  const prompt = buildPromptString(dictionaryWords(opts.dictionary ?? []), OPENAI_PROMPT_MAX_CHARS);
  if (prompt !== null) {
    form.append('prompt', prompt);
  }

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    await throwForResponse(res, 'STT transcription');
  }

  const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!json || typeof json.text !== 'string') {
    throw new EndpointError('STT transcription: response missing "text" field', res.status);
  }
  return { text: json.text, prompted: prompt !== null };
}

interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: { transcript?: unknown }[];
    }[];
  };
}

async function transcribeDeepgram(
  opts: TranscribeOptions,
  fetchImpl: typeof fetch,
): Promise<TranscribeResult> {
  const base = stripTrailingSlash(opts.settings.baseUrl ?? DEEPGRAM_DEFAULT_BASE);
  const params = new URLSearchParams({ model: opts.settings.model, smart_format: 'true' });

  // L2 biasing: Nova-3 / Flux take repeated `keyterm` params (canonical words +
  // sounds_like aliases, multi-word OK); legacy models take repeated `keywords`
  // (single words only — phrases are skipped rather than sent malformed).
  const entries = opts.dictionary ?? [];
  let prompted = false;
  if (entries.length > 0) {
    if (deepgramBiasingStyle(opts.settings.model) === 'keyterm') {
      const keyterms = deepgramKeytermWords(entries)
        .filter((w) => w.trim().length > 0)
        .slice(0, DEEPGRAM_KEYTERM_MAX_COUNT);
      for (const w of keyterms) params.append('keyterm', w);
      prompted = keyterms.length > 0;
    } else {
      const keywords = dictionaryWords(entries)
        .filter((w) => w.trim().length > 0 && !/\s/u.test(w.trim()))
        .slice(0, DEEPGRAM_KEYWORDS_MAX_COUNT);
      for (const w of keywords) params.append('keywords', w);
      prompted = keywords.length > 0;
    }
  }

  const url = `${base}/v1/listen?${params.toString()}`;

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${opts.apiKey}`,
      'Content-Type': opts.audio.mimeType,
    },
    // Deepgram batch accepts the raw audio bytes as the request body.
    body: opts.audio.bytes,
  });

  if (!res.ok) {
    await throwForResponse(res, 'STT transcription (Deepgram)');
  }

  const json = (await res.json().catch(() => null)) as DeepgramResponse | null;
  const transcript = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof transcript !== 'string') {
    throw new EndpointError(
      'STT transcription (Deepgram): response missing alternatives transcript',
      res.status,
    );
  }
  return { text: transcript, prompted };
}
