import { base64ToBytes, bytesToBase64 } from './base64';

describe('base64 codec', () => {
  it('round-trips arbitrary bytes', () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([255, 254, 253]),
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array(Array.from({ length: 100 }, (_, i) => i % 256)),
    ];
    for (const bytes of cases) {
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('decodes a known vector', () => {
    // "Man" → "TWFu"
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(Array.from(base64ToBytes('TWFu'))).toEqual([77, 97, 110]);
  });

  it('handles padding correctly', () => {
    expect(bytesToBase64(new Uint8Array([77]))).toBe('TQ==');
    expect(bytesToBase64(new Uint8Array([77, 97]))).toBe('TWE=');
  });
});
