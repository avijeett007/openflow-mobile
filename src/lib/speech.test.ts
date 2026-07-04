import { type SpeechTtsModule, type TtsVoice, createSpeech, matchVoice } from './speech';

const V = (identifier: string, language: string): TtsVoice => ({
  identifier,
  name: identifier,
  language,
});

describe('matchVoice', () => {
  const voices = [
    V('en-us', 'en-US'),
    V('en-gb', 'en-GB'),
    V('es-es', 'es-ES'),
    V('zh-hans', 'zh-Hans'),
    V('zh-hant', 'zh-Hant'),
  ];

  it('prefers a region-exact match', () => {
    expect(matchVoice('en-GB', voices)?.identifier).toBe('en-gb');
    expect(matchVoice('es-ES', voices)?.identifier).toBe('es-es');
  });

  it('falls back to the primary subtag when no region match', () => {
    expect(matchVoice('en-AU', voices)?.identifier).toBe('en-us'); // first en voice
    expect(matchVoice('es-MX', voices)?.identifier).toBe('es-es');
  });

  it('prefers the right Chinese script when both are installed', () => {
    expect(matchVoice('zh-Hans', voices)?.identifier).toBe('zh-hans');
    expect(matchVoice('zh-Hant', voices)?.identifier).toBe('zh-hant');
    // zh-CN infers Simplified script.
    expect(matchVoice('zh-CN', voices)?.identifier).toBe('zh-hans');
  });

  it('returns null for an unknown or empty language', () => {
    expect(matchVoice('ru', voices)).toBeNull();
    expect(matchVoice('', voices)).toBeNull();
  });
});

function fakeModule(voices: TtsVoice[]): SpeechTtsModule & {
  speak: jest.Mock;
  stop: jest.Mock;
} {
  return {
    getAvailableVoicesAsync: jest.fn(async () => voices),
    speak: jest.fn(),
    stop: jest.fn(async () => undefined),
    maxSpeechInputLength: 10,
  };
}

describe('createSpeech', () => {
  it('canSpeak is false with no module and false with no matching voice', async () => {
    expect(await createSpeech(() => null).canSpeak('en')).toBe(false);
    const s = createSpeech(() => fakeModule([V('en', 'en-US')]));
    expect(await s.canSpeak('ru')).toBe(false);
    expect(await s.canSpeak('en-GB')).toBe(true);
  });

  it('caches the voice list (one native call)', async () => {
    const mod = fakeModule([V('en', 'en-US')]);
    const s = createSpeech(() => mod);
    await s.canSpeak('en');
    await s.getVoices();
    await s.canSpeak('en');
    expect(mod.getAvailableVoicesAsync).toHaveBeenCalledTimes(1);
  });

  it('speak passes the matched voice + language and resolves on onDone', async () => {
    const mod = fakeModule([V('spanish-voice', 'es-ES')]);
    const s = createSpeech(() => mod);
    mod.speak.mockImplementation((_text, opts) => opts.onDone());
    await s.speak('hola mundo', 'es-MX');
    const [text, opts] = mod.speak.mock.calls[0];
    expect(text).toBe('hola mundo'.slice(0, 10)); // clipped to maxSpeechInputLength
    expect(opts.language).toBe('es-MX');
    expect(opts.voice).toBe('spanish-voice');
  });

  it('speak resolves (not hangs) when the engine errors', async () => {
    const mod = fakeModule([V('en', 'en-US')]);
    const s = createSpeech(() => mod);
    mod.speak.mockImplementation((_t, opts) => opts.onError(new Error('boom')));
    await expect(s.speak('hi', 'en')).resolves.toBeUndefined();
  });

  it('speak is a no-op for empty text and stop is best-effort', async () => {
    const mod = fakeModule([V('en', 'en-US')]);
    const s = createSpeech(() => mod);
    await s.speak('   ', 'en');
    expect(mod.speak).not.toHaveBeenCalled();
    await s.stop();
    expect(mod.stop).toHaveBeenCalled();
  });
});
