import {
  encodeHandoff,
  decodeHandoff,
  HandoffDecodeError,
  DictationHandoffSchema,
  type DictationHandoff,
} from './index';

describe('handoff codec', () => {
  it('roundtrips every status', () => {
    const samples: DictationHandoff[] = [
      { rid: 'x', status: 'recording' },
      { rid: 'x', status: 'transcribing' },
      { rid: 'x', status: 'cleaning' },
      { rid: 'x', status: 'ready', text: 'Hello world.' },
      { rid: 'x', status: 'error', error: 'network unavailable' },
    ];
    for (const s of samples) {
      expect(decodeHandoff(encodeHandoff(s))).toEqual(s);
    }
  });

  it('produces flat, stable JSON', () => {
    expect(encodeHandoff({ rid: 'abc-123', status: 'ready', text: 'Hi.' })).toBe(
      '{"rid":"abc-123","status":"ready","text":"Hi."}',
    );
  });

  it('rejects non-JSON input', () => {
    expect(() => decodeHandoff('not json')).toThrow(HandoffDecodeError);
  });

  it('rejects payloads missing rid', () => {
    expect(() => decodeHandoff('{"status":"ready"}')).toThrow(HandoffDecodeError);
  });

  it('rejects unknown status values', () => {
    expect(() => decodeHandoff('{"rid":"x","status":"bogus"}')).toThrow(HandoffDecodeError);
  });

  it('encode validates the payload', () => {
    // @ts-expect-error invalid status at compile time; still guarded at runtime.
    expect(() => encodeHandoff({ rid: 'x', status: 'nope' })).toThrow();
  });

  it('exposes a zod schema for callers', () => {
    expect(DictationHandoffSchema.safeParse({ rid: 'x', status: 'ready' }).success).toBe(true);
  });
});
