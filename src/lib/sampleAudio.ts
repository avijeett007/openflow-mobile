import type { SttAudio } from '@openflow/shared';

/**
 * Build a tiny synthetic WAV clip (16 kHz mono PCM16 silence) entirely in
 * memory. Used by the settings "Test speech-to-text" button so we can exercise
 * the STT endpoint without bundling a binary asset or touching the microphone.
 * A real provider will return an empty/near-empty transcript, which is fine —
 * the point of the test is to prove auth + connectivity + response shape.
 */
export function makeSampleAudio(durationSeconds = 0.4, sampleRate = 16000): SttAudio {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 2; // PCM16 mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  // data chunk (silence — all zeros already)
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return {
    bytes: new Uint8Array(buffer),
    mimeType: 'audio/wav',
    fileName: 'openflow-test.wav',
  };
}
