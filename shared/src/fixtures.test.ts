/**
 * Contract tests binding the JSON fixtures in ../fixtures to the actual client
 * behaviour. These fixtures are the source of truth for the Kotlin IME (C4)
 * HTTP mirror — if the TS clients drift from them, these tests fail.
 */
import * as fs from 'fs';
import * as path from 'path';
import { transcribe, type SttAudio } from './stt';
import { cleanTranscript } from './cleanup';
import { encodeHandoff, decodeHandoff, HandoffDecodeError } from './handoff';
import type { SttSettings, CleanupSettings } from './settings/schema';
import { makeFetch, jsonResponse, authHeader, formFieldNames } from './testHelpers';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

function loadFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

const API_KEY = 'TEST_KEY';

describe('STT fixtures', () => {
  const cases = ['stt-groq.json', 'stt-openai.json', 'stt-deepgram.json'];

  it.each(cases)('%s matches the client contract', async (file) => {
    const fx = loadFixture(file);
    const audio: SttAudio = {
      bytes: new TextEncoder().encode(fx.audio.bytesUtf8),
      mimeType: fx.audio.mimeType,
      fileName: fx.audio.fileName,
    };
    const fetchImpl = makeFetch(() => jsonResponse(fx.response.body, fx.response.status));
    const result = await transcribe({
      settings: fx.settings as SttSettings,
      audio,
      apiKey: API_KEY,
      fetchImpl,
    });
    expect(result.text).toBe(fx.expectedText);

    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe(fx.request.url);
    expect(call.init.method).toBe(fx.request.method);

    const expectedAuth = (fx.request.headers.Authorization as string).replace('<API_KEY>', API_KEY);
    expect(authHeader(call)).toBe(expectedAuth);

    if (fx.request.multipartFields) {
      expect(await formFieldNames(call)).toEqual(fx.request.multipartFields);
    }
    if (fx.request.bodyIsRawAudioBytes) {
      expect(call.init.body).toBe(audio.bytes);
    }
  });
});

describe('cleanup fixtures', () => {
  const cases = ['cleanup-groq.json', 'cleanup-ollama.json'];

  it.each(cases)('%s matches the client contract', async (file) => {
    const fx = loadFixture(file);
    const fetchImpl = makeFetch(() => jsonResponse(fx.response.body, fx.response.status));
    const hasAuth = Boolean(fx.request.headers.Authorization);
    const result = await cleanTranscript({
      settings: fx.settings as CleanupSettings,
      transcript: fx.transcript,
      apiKey: hasAuth ? API_KEY : '',
      fetchImpl,
    });
    expect(result.text).toBe(fx.expectedText);

    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe(fx.request.url);
    expect(call.init.method).toBe(fx.request.method);
    if (hasAuth) {
      expect(authHeader(call)).toBe('Bearer ' + API_KEY);
    } else {
      expect(authHeader(call)).toBeUndefined();
    }

    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe(fx.request.body.model);
    expect(body.temperature).toBe(fx.request.body.temperature);
    expect(body.stream).toBe(fx.request.body.stream);
    expect(body.messages.map((m: any) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[1].content).toBe(fx.transcript);
  });
});

describe('handoff fixtures', () => {
  const fx = loadFixture('handoff-samples.json');

  it('roundtrips every canonical sample', () => {
    for (const s of fx.samples) {
      expect(decodeHandoff(s.encoded)).toEqual(s.decoded);
      expect(encodeHandoff(s.decoded)).toBe(s.encoded);
    }
  });

  it('rejects every invalid sample', () => {
    for (const bad of fx.invalid) {
      expect(() => decodeHandoff(bad)).toThrow(HandoffDecodeError);
    }
  });
});
