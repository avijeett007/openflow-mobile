import {
  type LocalStt,
  type SpeechModule,
  createLocalStt,
  loadSpeechModule,
  runLocalSttTest,
} from './localStt';

type Listener = (ev: unknown) => void;

/** A fake native module with a controllable event bus. */
function makeFakeModule(
  caps: { recognition?: boolean; onDevice?: boolean; granted?: boolean } = {},
) {
  const listeners: Record<string, Listener[]> = {};
  const emit = (event: string, ev: unknown) => (listeners[event] ?? []).forEach((cb) => cb(ev));

  const mod = {
    startOptions: undefined as Record<string, unknown> | undefined,
    isRecognitionAvailable: jest.fn(() => caps.recognition ?? true),
    supportsOnDeviceRecognition: jest.fn(() => caps.onDevice ?? true),
    getPermissionsAsync: jest.fn(async () => ({ granted: caps.granted ?? true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: caps.granted ?? true })),
    start: jest.fn((opts: Record<string, unknown>) => {
      mod.startOptions = opts;
    }),
    stop: jest.fn(() => {
      emit('result', { isFinal: true, results: [{ transcript: 'final text' }] });
      emit('end', undefined);
    }),
    abort: jest.fn(() => emit('error', { error: 'aborted' })),
    addSpeechRecognitionListener: jest.fn((event: string, cb: Listener) => {
      (listeners[event] ??= []).push(cb);
      return {
        remove: jest.fn(() => {
          listeners[event] = (listeners[event] ?? []).filter((x) => x !== cb);
        }),
      };
    }),
  };
  return { mod: mod as unknown as SpeechModule & typeof mod, emit };
}

describe('createLocalStt.isAvailable', () => {
  it('reports unavailable when the native module is missing', async () => {
    const stt = createLocalStt(() => null);
    const res = await stt.isAvailable();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/native module/i);
  });

  it('reports unavailable when recognition is not available at all', async () => {
    const { mod } = makeFakeModule({ recognition: false });
    const res = await createLocalStt(() => mod).isAvailable();
    expect(res.available).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it('reports unavailable (with reason) when on-device recognition is unsupported', async () => {
    const { mod } = makeFakeModule({ onDevice: false });
    const res = await createLocalStt(() => mod).isAvailable();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/on-device|Remote/i);
  });

  it('reports available when recognition + on-device are both supported', async () => {
    const { mod } = makeFakeModule();
    expect(await createLocalStt(() => mod).isAvailable()).toEqual({ available: true });
  });
});

describe('createLocalStt live session', () => {
  it('starts strictly on-device (iOS on-device + Android EXTRA_PREFER_OFFLINE)', async () => {
    const { mod } = makeFakeModule();
    const stt = createLocalStt(() => mod);
    await stt.start();
    const opts = mod.startOptions as Record<string, unknown>;
    expect(opts.requiresOnDeviceRecognition).toBe(true);
    expect((opts.androidIntentOptions as Record<string, unknown>).EXTRA_PREFER_OFFLINE).toBe(true);
    expect(opts.interimResults).toBe(true);
  });

  it('streams partials then resolves stop() with the final transcript', async () => {
    const { mod, emit } = makeFakeModule();
    const stt = createLocalStt(() => mod);
    const partials: string[] = [];

    await stt.start({ onPartial: (t) => partials.push(t) });
    emit('result', { isFinal: false, results: [{ transcript: 'hello' }] });

    const result = await stt.stop(); // mod.stop() emits final result + end
    expect(partials).toEqual(['hello']);
    expect(result.transcript).toBe('final text');
  });

  it('rejects stop() when the session errored mid-recognition', async () => {
    const { mod, emit } = makeFakeModule();
    const stt = createLocalStt(() => mod);
    await stt.start();
    emit('error', { error: 'network', message: 'boom' });
    emit('end', undefined);
    await expect(stt.stop()).rejects.toThrow('boom');
  });

  it('cancel() aborts and does not throw', async () => {
    const { mod } = makeFakeModule();
    const stt = createLocalStt(() => mod);
    await stt.start();
    await stt.cancel();
    expect(mod.abort).toHaveBeenCalled();
  });
});

describe('runLocalSttTest', () => {
  const immediate = async () => undefined;

  function fakeRecognizer(overrides: Partial<LocalStt> = {}): LocalStt {
    return {
      isAvailable: async () => ({ available: true }),
      requestPermission: async () => true,
      start: async () => undefined,
      stop: async () => ({ transcript: 'hi there' }),
      cancel: async () => undefined,
      ...overrides,
    };
  }

  it('fails with the availability reason when unavailable', async () => {
    const rec = fakeRecognizer({
      isAvailable: async () => ({ available: false, reason: 'no language pack' }),
    });
    const res = await runLocalSttTest(rec, 0, immediate);
    expect(res).toEqual({ ok: false, detail: 'no language pack' });
  });

  it('fails when permission is not granted', async () => {
    const rec = fakeRecognizer({ requestPermission: async () => false });
    const res = await runLocalSttTest(rec, 0, immediate);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/permission/i);
  });

  it('passes and reports what it heard', async () => {
    const res = await runLocalSttTest(fakeRecognizer(), 0, immediate);
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('hi there');
  });
});

describe('loadSpeechModule', () => {
  it('loads the (jest-mocked) native module surface', () => {
    const mod = loadSpeechModule();
    expect(mod).not.toBeNull();
    // Jest mock reports the recognizer as unavailable under the test runner.
    expect(mod?.isRecognitionAvailable()).toBe(false);
  });
});
