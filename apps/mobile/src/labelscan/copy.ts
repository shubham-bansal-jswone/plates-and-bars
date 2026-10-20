import type { LabelWarning } from '@plate-and-bar/core';
import type { OcrErrorCode } from '../../modules/plate-label-scanner/types';

/** Copy for the label scan screens (#1067, ADR 010). No message holds the recognised text or the image address. */
export const LABEL_COPY = {
  entry: 'Scan a nutrition label',
  entryA11y: 'Scan the nutrition label on a pack to add a packaged food',
  title: 'Scan a nutrition label',
  intro: 'Take one photo of the nutrition table. The photo is read on this phone and is never saved or sent.',
  take: 'Take a photo',
  choose: 'Choose a photo',
  typeIt: 'Type it in',
  tryAgain: 'Try again',
  close: 'Close',
  cancel: 'Cancel',
  cameraDenied: 'Camera is off for Plate & Bar. Choose a photo instead, or type it in.',
  cameraFailed: 'The photo could not be taken. Try again, or type it in.',

  cropTitle: 'Frame the nutrition table',
  cropHint: 'Trim the photo so only the nutrition table is inside the frame.',
  cropPhoto: 'Your photo with the frame around the part that will be read',
  read: 'Read the label',
  retake: 'Take another photo',
  trimMore: (edge: string) => `Trim more from the ${edge}`,
  trimLess: (edge: string) => `Trim less from the ${edge}`,
  frame: (w: number, h: number) => `Reading ${w}% of the width and ${h}% of the height.`,

  reading: 'Reading the label. This can take a few seconds.',
  unreadable: 'Couldn’t read this label. Try again with the nutrition table filling the frame, or type it in.',

  reviewTitle: 'Check the label',
  reviewIntro: 'The numbers were read from your photo and can be wrong. Check each one against the pack.',
  basis100: (unit: string) => `Per ${unit}`,
  basisServing: (unit: string) => `Per serving: ${unit}`,
  basisUnknown: 'Could not tell what the numbers are per. Enter the serving size they are for.',
  perServing: 'Use per serving instead',
  name: 'Food',
  nameHint: 'Type the name of the product. The photo does not give it.',
  serving: 'Serving size',
  calories: 'Calories (kcal)',
  protein: 'Protein (g)',
  carbs: 'Carbs (g)',
  fat: 'Fat (g)',
  fibre: 'Fibre (g)',
  addedSugar: 'Added sugar (g)',
  check: 'Check this against the pack.',
  notRead: 'Not read. Enter it from the pack.',
  optional: 'Optional.',
  save: 'Save to my foods for next time',
  invalid: 'Check the numbers: none can be negative or more than the serving, and fibre cannot be more than carbs.',
  openSettings: 'Open settings',
  commaAmbiguous: 'Use a dot for decimals, or type the number without a comma.',
  servingNeeded: 'Enter the serving size these numbers are for, in g or ml, for example 30 g.',
};

/** One plain message for each way `recognize` can fail. */
export const OCR_PROBLEM: Record<OcrErrorCode, string> = {
  disabled: 'Label scanning is switched off in this version. Type the numbers in instead.',
  unsupported: 'Label scanning is not available on this device. Type the numbers in instead.',
  image: 'That photo could not be opened. Try another photo, or type it in.',
  crop: 'The frame was too small. Try again and leave more of the table inside it, or type it in.',
  memory: 'This phone ran out of memory reading the photo. Try again, or type it in.',
  engine: 'The text reader did not start. Try again, or type it in.',
  data: 'The text reader could not load its data. Try again, or type it in.',
  failed: 'The label could not be read. Try again, or type it in.',
};

/** What each parser warning means for the person checking the numbers. */
export const WARNING_COPY: Record<LabelWarning, string> = {
  no_header: 'No nutrition heading was found, so every number is less certain.',
  basis_unknown: 'It is not clear what the numbers are per. Check the serving size.',
  serving_grams_missing: 'The weight of a serving was not read. Enter the serving size yourself.',
  serving_grams_fractional: 'The serving weight has a decimal, so the serving size is blank. Enter it yourself.',
  basis_serving_unit_mismatch: 'The serving and the per 100 column use different units (g and ml). Check every number.',
  basis_unit_inferred: 'The unit of the per 100 column was guessed. Check it is g or ml as on the pack.',
  looks_off: 'These numbers look off: they do not add up to the calories. Check the pack.',
  serving_mismatch: 'The per 100 column and the per serving column disagree. Check them against the pack.',
  fibre_exceeds_carbs: 'Fibre is more than carbs. Check both.',
};
