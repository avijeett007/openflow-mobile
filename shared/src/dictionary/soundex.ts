/**
 * American Soundex phonetic matcher — a TS port of the desktop engine's
 * `natural::phonetics::soundex` boolean comparison (openflow
 * src-tauri/src/audio_toolkit/text.rs). Used only as a *boost* inside the fuzzy
 * pass (a phonetic match multiplies the Levenshtein score by 0.3), so it never
 * decides a match on its own.
 *
 * The classic algorithm: keep the first letter, map the rest to digits
 * (b/f/p/v→1, c/g/j/k/q/s/x/z→2, d/t→3, l→4, m/n→5, r→6, everything else→0),
 * collapse runs of the same digit, drop zeros, then pad/truncate to a 4-char
 * code. `soundex(a, b)` returns whether the two words share a code.
 *
 * Soundex is inherently an ASCII/English heuristic: non-`[a-z]` code points are
 * dropped before encoding, matching how the desktop crate degrades on
 * non-Latin input (the fuzzy pass still leans on Levenshtein for those).
 */

/** Soundex digit for a lowercase letter; `'0'` for vowels / h / w / y / other. */
function soundexDigit(c: string): string {
  switch (c) {
    case 'b':
    case 'f':
    case 'p':
    case 'v':
      return '1';
    case 'c':
    case 'g':
    case 'j':
    case 'k':
    case 'q':
    case 's':
    case 'x':
    case 'z':
      return '2';
    case 'd':
    case 't':
      return '3';
    case 'l':
      return '4';
    case 'm':
    case 'n':
      return '5';
    case 'r':
      return '6';
    default:
      return '0';
  }
}

/** Compute the 4-character Soundex code, or `''` when the word has no letters. */
function soundexCode(word: string): string {
  const letters = [...word.toLowerCase()].filter((c) => c >= 'a' && c <= 'z');
  if (letters.length === 0) {
    return '';
  }
  const first = letters[0] as string;
  let code = first.toUpperCase();
  let last = soundexDigit(first);
  for (let i = 1; i < letters.length && code.length < 4; i += 1) {
    const d = soundexDigit(letters[i] as string);
    if (d !== '0' && d !== last) {
      code += d;
    }
    last = d;
  }
  return (code + '000').slice(0, 4);
}

/** Whether two words share a Soundex code (empty/letterless words never match). */
export function soundex(a: string, b: string): boolean {
  const ca = soundexCode(a);
  const cb = soundexCode(b);
  if (ca === '' || cb === '') {
    return false;
  }
  return ca === cb;
}
