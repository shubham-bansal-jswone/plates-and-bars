import type { OcrLine } from '../modules/plate-label-scanner';

const L = (text: string, confidence = 95): OcrLine => ({ text, confidence });

/** A per 100 g label with a per serve (30 g) column: every field read with high confidence, and an alternate. */
export const FULL: OcrLine[] = [
  L('Nutritional Information'), L('Per 100 g Per serve (30 g)'), L('Energy 400 kcal 120 kcal'), L('Protein 20 g 6 g'), L('Carbohydrate 50 g 15 g'),
  L('Total Fat 10 g 3 g'), L('Dietary Fibre 8 g 2.4 g'), L('Added Sugars 5 g 1.5 g'),
];

/** Per 100 g only: protein read with low OCR confidence (medium), fibre row with no number (low), no fat row (missing), no added sugar row. */
export const PARTIAL: OcrLine[] = [L('Nutritional Information'), L('Per 100 g'), L('Energy 400 kcal'), L('Protein 20 g', 60), L('Carbohydrate 50 g'), L('Fibre')];

/** Energy far below what the macros give: the parser warns `looks_off`. */
export const LOOKS_OFF: OcrLine[] = [L('Nutritional Information'), L('Per 100 g'), L('Energy 100 kcal'), L('Protein 20 g'), L('Carbohydrate 50 g'), L('Total Fat 10 g')];

/** Nothing the parser can use. */
export const NOISE: OcrLine[] = [L('hello world')];

export const ok = (lines: OcrLine[]) => ({ lines, ms: 5 });
