import { act, renderHook } from '@testing-library/react-native';
import {
  type TurnSpeech,
  type TurnTranslator,
  useTranslatorTurn,
} from './useTranslatorTurn';
import type { LocalStt, LocalSttStartOptions } from '../lib/localStt';

/** Drain chained microtasks inside act (onMicTap runs a fire-and-forget async IIFE). */
async function flush(times = 12): Promise<void> {
  await act(async () => {
    for (let i = 0; i < times; i++) await Promise.resolve();
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  localStt: jest.Mocked<LocalStt> & { lastStart?: LocalSttStartOptions };
  translator: jest.Mocked<TurnTranslator>;
  speech: jest.Mocked<TurnSpeech>;
}

function makeHarness(over: Partial<Harness> = {}): Harness {
  const startOpts: { lastStart?: LocalSttStartOptions } = {};
  const localStt = {
    isAvailable: jest.fn(async () => ({ available: true })),
    requestPermission: jest.fn(async () => true),
    start: jest.fn(async (opts?: LocalSttStartOptions) => {
      startOpts.lastStart = opts;
    }),
    stop: jest.fn(async () => ({ transcript: 'hello' })),
    cancel: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<LocalStt> & { lastStart?: LocalSttStartOptions };
  Object.defineProperty(localStt, 'lastStart', { get: () => startOpts.lastStart });

  const translator = {
    translate: jest.fn(async () => ({ text: 'hola' })),
    identifyLanguage: jest.fn(async () => null),
  } as unknown as jest.Mocked<TurnTranslator>;

  const speech = {
    canSpeak: jest.fn(async () => true),
    speak: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<TurnSpeech>;

  return { localStt, translator, speech, ...over };
}

function setup(h: Harness, opts: Partial<Parameters<typeof useTranslatorTurn>[0]> = {}) {
  return renderHook(() =>
    useTranslatorTurn({
      localStt: h.localStt,
      translator: h.translator,
      speech: h.speech,
      initialLangs: { a: 'en', b: 'es' },
      initialSpeakEnabled: true,
      makeId: () => 'id-1',
      now: () => 1000,
      ...opts,
    }),
  );
}

describe('useTranslatorTurn — happy path', () => {
  it('mic → listen → stop → translate → show → speak', async () => {
    const h = makeHarness();
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();
    expect(result.current.state.status).toBe('listening');
    expect(result.current.state.activeSide).toBe('a');
    expect(h.localStt.start).toHaveBeenCalled();
    expect(h.localStt.lastStart?.lang).toBe('en');

    // Live partial streams through the reducer.
    act(() => h.localStt.lastStart?.onPartial?.('hel'));
    expect(result.current.state.partialText).toBe('hel');

    // Tap same side again → stop → translate → speak.
    act(() => result.current.onMicTap('a'));
    await flush();

    expect(h.translator.translate).toHaveBeenCalledWith('hello', 'en', 'es');
    expect(h.speech.speak).toHaveBeenCalledWith('hola', 'es');
    expect(result.current.state.status).toBe('showing');
    expect(result.current.state.current?.translatedText).toBe('hola');
    expect(result.current.state.current?.spoken).toBe(true);
    expect(result.current.state.history).toHaveLength(1);
  });

  it('does not speak when no voice is installed for the target', async () => {
    const h = makeHarness();
    h.speech.canSpeak.mockResolvedValue(false);
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();
    act(() => result.current.onMicTap('a'));
    await flush();

    expect(h.speech.speak).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('showing');
    expect(result.current.state.current?.spoken).toBe(false);
  });

  it('empty transcript returns to idle with no turn or error', async () => {
    const h = makeHarness();
    h.localStt.stop.mockResolvedValue({ transcript: '   ' });
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();
    act(() => result.current.onMicTap('a'));
    await flush();

    expect(result.current.state.status).toBe('idle');
    expect(h.translator.translate).not.toHaveBeenCalled();
    expect(result.current.state.error).toBeUndefined();
  });
});

describe('useTranslatorTurn — error paths', () => {
  it('STT unavailable → error with the availability reason', async () => {
    const h = makeHarness();
    h.localStt.isAvailable.mockResolvedValue({ available: false, reason: 'no language pack' });
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('no language pack');
    expect(h.localStt.start).not.toHaveBeenCalled();
  });

  it('permission denied → error', async () => {
    const h = makeHarness();
    h.localStt.requestPermission.mockResolvedValue(false);
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toMatch(/permission/i);
  });

  it('translate failure → error carries the message, history survives', async () => {
    const h = makeHarness();
    h.translator.translate.mockRejectedValue(new Error('pack missing'));
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();
    act(() => result.current.onMicTap('a'));
    await flush();

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('pack missing');
  });
});

describe('useTranslatorTurn — barge-in', () => {
  it('a tap during speaking stops TTS and starts a fresh turn on the tapped side', async () => {
    const h = makeHarness();
    const speakDef = deferred<void>();
    h.speech.speak.mockReturnValue(speakDef.promise);
    const { result } = setup(h);

    act(() => result.current.onMicTap('a'));
    await flush();
    act(() => result.current.onMicTap('a'));
    await flush();
    // TTS is pending → machine is parked in 'speaking'.
    expect(result.current.state.status).toBe('speaking');

    // Barge-in from the other side.
    act(() => result.current.onMicTap('b'));
    await flush();

    expect(h.speech.stop).toHaveBeenCalled();
    expect(result.current.state.status).toBe('listening');
    expect(result.current.state.activeSide).toBe('b');

    await act(async () => {
      speakDef.resolve();
      await Promise.resolve();
    });
  });
});

describe('useTranslatorTurn — auto-detect flip', () => {
  it('flips direction when the other side’s language is detected', async () => {
    const h = makeHarness();
    // Side 'a' (en) tapped, but the speaker actually spoke Spanish (side 'b').
    h.translator.identifyLanguage.mockResolvedValue('es');
    const { result } = setup(h, { autoDetect: true });

    act(() => result.current.onMicTap('a'));
    await flush();
    act(() => result.current.onMicTap('a'));
    await flush();

    // Translation runs es → en, and the exchange is attributed to side 'b'.
    expect(h.translator.translate).toHaveBeenCalledWith('hello', 'es', 'en');
    expect(result.current.state.current?.side).toBe('b');
    expect(result.current.state.current?.sourceLang).toBe('es');
    expect(result.current.state.current?.targetLang).toBe('en');
    expect(result.current.state.current?.detectedLang).toBe('es');
  });

  it('does not flip when the detected language is this side’s own', async () => {
    const h = makeHarness();
    h.translator.identifyLanguage.mockResolvedValue('en');
    const { result } = setup(h, { autoDetect: true });

    act(() => result.current.onMicTap('a'));
    await flush();
    act(() => result.current.onMicTap('a'));
    await flush();

    expect(h.translator.translate).toHaveBeenCalledWith('hello', 'en', 'es');
    expect(result.current.state.current?.side).toBe('a');
  });
});

describe('useTranslatorTurn — settings + language changes', () => {
  it('setLang / swapLangs persist via callbacks when idle', async () => {
    const h = makeHarness();
    const onLangsChange = jest.fn();
    const { result } = setup(h, { onLangsChange });

    act(() => result.current.setLang('b', 'fr'));
    expect(result.current.state.langs).toEqual({ a: 'en', b: 'fr' });
    expect(onLangsChange).toHaveBeenLastCalledWith({ a: 'en', b: 'fr' });

    act(() => result.current.swapLangs());
    expect(result.current.state.langs).toEqual({ a: 'fr', b: 'en' });
    expect(onLangsChange).toHaveBeenLastCalledWith({ a: 'fr', b: 'en' });
  });

  it('setSpeakEnabled persists and gates future speak', async () => {
    const h = makeHarness();
    const onSpeakEnabledChange = jest.fn();
    const { result } = setup(h, { onSpeakEnabledChange });

    act(() => result.current.setSpeakEnabled(false));
    expect(result.current.state.speakEnabled).toBe(false);
    expect(onSpeakEnabledChange).toHaveBeenCalledWith(false);
  });

  it('maps translation lang → STT locale using device locales', async () => {
    const h = makeHarness();
    const { result } = setup(h, { sttLocales: ['en-US', 'es-ES'] });

    act(() => result.current.onMicTap('a'));
    await flush();
    expect(h.localStt.lastStart?.lang).toBe('en-US');
  });
});
