/** The one "blank" rule (#421, contract wire conventions): Unicode White_Space plus U+200B to U+200D, U+2060 and U+FEFF. `trim()` misses the zero-width ones and U+0085. */
const BLANK = /^[\t-\r \u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$/;

/** True when `s` is empty or has nothing but blank characters. */
export const isBlank = (s: string): boolean => BLANK.test(s);
