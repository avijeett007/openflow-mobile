import { makeSampleAudio } from './sampleAudio';

describe('makeSampleAudio', () => {
  it('produces a well-formed 16kHz mono WAV', () => {
    const audio = makeSampleAudio(0.1, 16000);
    expect(audio.mimeType).toBe('audio/wav');
    expect(audio.fileName).toMatch(/\.wav$/);

    const ascii = (start: number, len: number) =>
      String.fromCharCode(...audio.bytes.slice(start, start + len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');

    const view = new DataView(audio.bytes.buffer);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    // 44-byte header + 0.1s * 16000 * 2 bytes = 44 + 3200
    expect(audio.bytes.length).toBe(44 + 1600 * 2);
  });
});
