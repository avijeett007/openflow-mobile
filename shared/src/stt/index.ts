import { ConfigError, throwForResponse, EndpointError } from '../errors';
import type { SttProvider, SttSettings } from '../settings/schema';

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
  /** Injectable fetch for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface TranscribeResult {
  text: string;
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
  return { text: json.text };
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
  return { text: transcript };
}
