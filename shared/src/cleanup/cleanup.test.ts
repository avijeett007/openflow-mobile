import { cleanTranscript, resolvePrompt, assembleCleanupMessages } from './index';
import type { CleanupSettings, Prompt } from '../settings/schema';
import { AuthError, EndpointError, ConfigError } from '../errors';
import { makeFetch, jsonResponse, textResponse, authHeader } from '../testHelpers';

function cleanupSettings(overrides: Partial<CleanupSettings> = {}): CleanupSettings {
  return {
    enabled: true,
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    apiKeyRef: 'cleanup.apiKey',
    promptId: 'improve-transcription',
    ...overrides,
  };
}

function chatResponse(content: string) {
  return jsonResponse({ choices: [{ message: { role: 'assistant', content } }] });
}

describe('cleanTranscript', () => {
  it('posts chat completion to Groq and returns trimmed content', async () => {
    const fetchImpl = makeFetch(() => chatResponse('  Cleaned text.  '));
    const result = await cleanTranscript({
      settings: cleanupSettings(),
      transcript: 'raw text',
      apiKey: 'test-key',
      fetchImpl,
    });
    expect(result.text).toBe('Cleaned text.');

    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(authHeader(call)).toBe('Bearer test-key');
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'raw text' });
  });

  it('omits Authorization for keyless Ollama and targets its base', async () => {
    const fetchImpl = makeFetch(() => chatResponse('cleaned'));
    await cleanTranscript({
      settings: cleanupSettings({ provider: 'ollama', model: 'llama3.1' }),
      transcript: 'x',
      apiKey: '',
      fetchImpl,
    });
    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(authHeader(call)).toBeUndefined();
  });

  it('requires a baseUrl for custom provider', async () => {
    const fetchImpl = makeFetch(() => chatResponse('x'));
    await expect(
      cleanTranscript({
        settings: cleanupSettings({ provider: 'custom' }),
        transcript: 'x',
        apiKey: 'k',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('resolves a custom prompt from the prompts list', async () => {
    const prompts: Prompt[] = [{ id: 'terse', name: 'Terse', prompt: 'Be terse.' }];
    const fetchImpl = makeFetch(() => chatResponse('ok'));
    await cleanTranscript({
      settings: cleanupSettings({ promptId: 'terse' }),
      transcript: 'x',
      apiKey: 'k',
      prompts,
      fetchImpl,
    });
    const body = JSON.parse(fetchImpl.calls[0]!.init.body as string);
    expect(body.messages[0].content).toBe('Be terse.');
  });

  it('throws AuthError on 401 and EndpointError on malformed response', async () => {
    const authFetch = makeFetch(() => textResponse('nope', 401));
    await expect(
      cleanTranscript({ settings: cleanupSettings(), transcript: 'x', apiKey: 'bad', fetchImpl: authFetch }),
    ).rejects.toBeInstanceOf(AuthError);

    const badFetch = makeFetch(() => jsonResponse({ choices: [] }));
    await expect(
      cleanTranscript({ settings: cleanupSettings(), transcript: 'x', apiKey: 'k', fetchImpl: badFetch }),
    ).rejects.toBeInstanceOf(EndpointError);
  });
});

describe('prompt assembly', () => {
  it('falls back to the built-in prompt when id is unknown', () => {
    const p = resolvePrompt('does-not-exist', []);
    expect(p.id).toBe('improve-transcription');
  });

  it('builds system + user messages', () => {
    expect(assembleCleanupMessages('SYS', 'USR')).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  });
});
