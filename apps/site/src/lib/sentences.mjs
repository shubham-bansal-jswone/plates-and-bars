// One sentence-split pattern for the blog and its check: split after . ! ? before a capital, digit or opening quote,
// but not after an abbreviation such as "e.g." or "et al.". Plain .mjs so scripts/blog-check.mjs can import it.
export const SENTENCE_SPLIT = /(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs|al|approx|cf|no)\.)\s+(?=[A-Z0-9"'‘“(])/;
