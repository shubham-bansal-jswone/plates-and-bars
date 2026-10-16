// The shared "blank text" rule (issue #421, contract 0.1.13). Blank = Unicode White_Space plus
// U+200B to U+200D, U+2060 and U+FEFF. Same class as packages/api/test-vectors/blank-text.json,
// which test/blank-text.test.mjs runs. The app's isBlank mirrors this; keep the two aligned.
const NOT_BLANK = /[^\t-\r \u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/;

export const nonEmpty = (v) => typeof v === 'string' && NOT_BLANK.test(v);
