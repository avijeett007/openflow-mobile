import { transcribe, type SttAudio } from './index';
import type { DictionaryEntry, SttSettings } from '../settings/schema';
import { AuthError, EndpointError, ConfigError } from '../errors';
import {
  makeFetch,
  jsonResponse,
  textResponse,
  authHeader,
  formFieldNames,
} from '../testHelpers';

const audio: SttAudio = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  mimeType: 'audio/m4a',
  fileName: 'audio.m4a',
};

function sttSettings(overrides: Partial<SttSettings> = {}): SttSettings {
  return {
    mode: 'remote',
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    apiKeyRef: 'stt.apiKey',
    ...overrides,
  };
}

describe('transcribe — OpenAI-compatible', () => {
  it('posts multipart to Groq and returns text', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ text: 'Hello Groq.' }));
    const result = await transcribe({
      settings: sttSettings(),
      audio,
      apiKey: 'test-key',
      fetchImpl,
    });
    expect(result.text).toBe('Hello Groq.');

    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(call.init.method).toBe('POST');
    expect(authHeader(call)).toBe('Bearer test-key');
    expect(await formFieldNames(call)).toEqual(['file', 'model', 'response_format']);
  });

  it('targets OpenAI base for the openai provider', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ text: 'Hi OpenAI.' }));
    await transcribe({
      settings: sttSettings({ provider: 'openai', model: 'whisper-1' }),
      audio,
      apiKey: 'k',
      fetchImpl,
    });
    expect(fetchImpl.calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
  });

  it('uses a custom baseUrl and requires one', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ text: 'custom' }));
    await transcribe({
      settings: sttSettings({ provider: 'custom', baseUrl: 'https://stt.example.com/v1' }),
      audio,
      apiKey: 'k',
      fetchImpl,
    });
    expect(fetchImpl.calls[0]!.url).toBe('https://stt.example.com/v1/audio/transcriptions');

    await expect(
      transcribe({ settings: sttSettings({ provider: 'custom' }), audio, apiKey: 'k', fetchImpl }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('throws AuthError on 401', async () => {
    const fetchImpl = makeFetch(() => textResponse('unauthorized', 401));
    await expect(
      transcribe({ settings: sttSettings(), audio, apiKey: 'bad', fetchImpl }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws EndpointError with status + body snippet on 500', async () => {
    const fetchImpl = makeFetch(() => textResponse('internal boom', 500));
    await expect(
      transcribe({ settings: sttSettings(), audio, apiKey: 'k', fetchImpl }),
    ).rejects.toMatchObject({ name: 'EndpointError', status: 500, bodySnippet: 'internal boom' });
  });

  it('throws EndpointError on malformed (missing text) response', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ nope: true }));
    await expect(
      transcribe({ settings: sttSettings(), audio, apiKey: 'k', fetchImpl }),
    ).rejects.toBeInstanceOf(EndpointError);
  });
});

describe('transcribe — Deepgram', () => {
  const dgResponse = {
    results: { channels: [{ alternatives: [{ transcript: 'Hello Deepgram.' }] }] },
  };

  it('posts raw bytes with Token auth and parses the transcript', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(dgResponse));
    const result = await transcribe({
      settings: sttSettings({ provider: 'deepgram', model: 'nova-2' }),
      audio,
      apiKey: 'dg-key',
      fetchImpl,
    });
    expect(result.text).toBe('Hello Deepgram.');

    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true');
    expect(authHeader(call)).toBe('Token dg-key');
    expect(call.init.body).toBe(audio.bytes);
  });

  it('throws EndpointError when alternatives are missing', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ results: { channels: [] } }));
    await expect(
      transcribe({
        settings: sttSettings({ provider: 'deepgram' }),
        audio,
        apiKey: 'k',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(EndpointError);
  });
});

// ---- L2 engine biasing (dictionary) ----------------------------------------

function entry(word: string, sounds_like: string[] = []): DictionaryEntry {
  return { word, sounds_like, replace_exact: false, case_sensitive: false };
}

function formField(call: { init: RequestInit }, name: string): string | null {
  const body = call.init.body;
  if (!(body instanceof FormData)) throw new Error('recorded body is not FormData');
  const v = body.get(name);
  return typeof v === 'string' ? v : null;
}

describe('transcribe — biasing (OpenAI-compatible prompt)', () => {
  it('appends a `prompt` field of canonical words and reports prompted=true', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ text: 'ok' }));
    const result = await transcribe({
      settings: sttSettings(),
      audio,
      apiKey: 'k',
      dictionary: [entry('ChargeBee', ['charge bee']), entry('Kubernetes')],
      fetchImpl,
    });
    expect(result.prompted).toBe(true);
    const call = fetchImpl.calls[0]!;
    expect(await formFieldNames(call)).toContain('prompt');
    // Canonical words only, comma-joined; aliases are not in the prompt.
    expect(formField(call, 'prompt')).toBe('ChargeBee, Kubernetes');
  });

  it('sends no `prompt` and reports prompted=false for an empty dictionary', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ text: 'ok' }));
    const result = await transcribe({ settings: sttSettings(), audio, apiKey: 'k', fetchImpl });
    expect(result.prompted).toBe(false);
    expect(await formFieldNames(fetchImpl.calls[0]!)).not.toContain('prompt');
  });
});

describe('transcribe — biasing (Deepgram keyterm/keywords)', () => {
  const dgResponse = {
    results: { channels: [{ alternatives: [{ transcript: 'ok' }] }] },
  };

  it('Nova-3 sends repeated `keyterm` params (words + aliases), prompted=true', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(dgResponse));
    const result = await transcribe({
      settings: sttSettings({ provider: 'deepgram', model: 'nova-3' }),
      audio,
      apiKey: 'dg',
      dictionary: [entry('ChargeBee', ['charge bee'])],
      fetchImpl,
    });
    expect(result.prompted).toBe(true);
    const params = new URL(fetchImpl.calls[0]!.url).searchParams;
    expect(params.getAll('keyterm')).toEqual(['ChargeBee', 'charge bee']);
  });

  it('legacy models send `keywords` (single words only; phrases skipped)', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(dgResponse));
    const result = await transcribe({
      settings: sttSettings({ provider: 'deepgram', model: 'nova-2' }),
      audio,
      apiKey: 'dg',
      dictionary: [entry('ChargeBee'), entry('MacBook Pro')],
      fetchImpl,
    });
    expect(result.prompted).toBe(true);
    const params = new URL(fetchImpl.calls[0]!.url).searchParams;
    // "MacBook Pro" is a phrase → skipped by the legacy keywords param.
    expect(params.getAll('keywords')).toEqual(['ChargeBee']);
    expect(params.getAll('keyterm')).toEqual([]);
  });

  it('reports prompted=false for an empty dictionary', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(dgResponse));
    const result = await transcribe({
      settings: sttSettings({ provider: 'deepgram', model: 'nova-3' }),
      audio,
      apiKey: 'dg',
      fetchImpl,
    });
    expect(result.prompted).toBe(false);
    const params = new URL(fetchImpl.calls[0]!.url).searchParams;
    expect(params.getAll('keyterm')).toEqual([]);
    expect(params.getAll('keywords')).toEqual([]);
  });
});
