/**
 * Minimal base64 <-> bytes helpers. Pure TypeScript (no RN/Buffer dependency)
 * so they run identically in the app and under Jest/node. Used to turn a
 * recorded file (read as base64 by expo-file-system) into the `Uint8Array` the
 * shared STT client expects.
 */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < B64_CHARS.length; i++) map[B64_CHARS[i]] = i;
  return map;
})();

/** Decode a standard base64 string into raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((clean.length * 3) / 4) - padding;
  const bytes = new Uint8Array(byteLength);

  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean[i]] ?? 0;
    const c1 = B64_LOOKUP[clean[i + 1]] ?? 0;
    const c2 = B64_LOOKUP[clean[i + 2]] ?? 0;
    const c3 = B64_LOOKUP[clean[i + 3]] ?? 0;

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (p < byteLength) bytes[p++] = (triple >> 16) & 0xff;
    if (p < byteLength) bytes[p++] = (triple >> 8) & 0xff;
    if (p < byteLength) bytes[p++] = triple & 0xff;
  }
  return bytes;
}

/** Encode raw bytes into a standard base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;

    out += B64_CHARS[(triple >> 18) & 0x3f];
    out += B64_CHARS[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_CHARS[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? B64_CHARS[triple & 0x3f] : '=';
  }
  return out;
}
