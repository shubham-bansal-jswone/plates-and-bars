/** Copy for the barcode scanner (#944, spec D6). No message holds a barcode. */
export const BARCODE_COPY = {
  title: 'Scan barcode',
  viewfinder: 'Point the camera at the barcode on the pack.',
  rationale: 'Plate & Bar uses the camera to read barcodes. Nothing from the camera is saved or sent.',
  rationaleTitle: 'Camera for barcodes',
  allow: 'Allow camera',
  allowA11y: 'Allow the camera to read barcodes',
  cancel: 'Not now',
  denied: 'Camera is off for Plate & Bar. Type the barcode instead.',
  openSettings: 'Open settings',
  unavailable: 'Scanning is not available on this device. Type the barcode instead.',
  cameraFailed: 'The camera did not start. Type the barcode instead.',
  typeInstead: 'Type the barcode instead',
  fieldLabel: 'Barcode number',
  fieldHint: 'The digits under the bars, 8, 12 or 13 of them',
  use: 'Use this number',
  invalid: 'That number does not look right. Check the digits on the pack.',
  scanAgain: 'Scan again',
  torchOn: 'Turn the torch on',
  torchOff: 'Turn the torch off',
  close: 'Close',

  // Lookup and review (spec D6). No message holds a barcode.
  scanButton: 'Scan barcode',
  scanButtonA11y: 'Scan a barcode to add a packaged food',
  looking: 'Looking up this barcode',
  lookupNote: 'The barcode number goes to our server, which asks Open Food Facts. Your name and account are not sent.',
  banner: 'From Open Food Facts, a community database. Check the numbers against the pack.',
  missing: 'Not in the database. Enter it from the pack.',
  looksOff: 'These numbers look off. Check the pack.',
  incomplete: 'Open Food Facts marks this entry as incomplete. Check the numbers against the pack.',
  qualityErrors: 'Open Food Facts lists problems with this entry. Check the numbers against the pack.',
  carbsFibre: 'Carbohydrate is as printed on the pack. Check it includes fibre.',
  liquid: 'This one is measured in ml, so entering grams is off. Use servings.',
  savedNote: 'You saved this food from a scan before. No lookup was needed.',
  notFound: 'Open Food Facts does not have this product yet. Enter it yourself.',
  byHand: 'Enter by hand',
  offline: 'No connection. Try again when you are online, or enter it by hand.',
  lookupDown: 'Open Food Facts did not answer. Try again in a minute, or enter it by hand.',
  tryAgain: 'Try again',
  attribution: 'Open Food Facts (ODbL)',
  attributionA11y: 'Open Food Facts (ODbL), opens the product page',
  customCode: 'Barcode saved with this food:',
  save: 'Save to my foods for next time',
  name: 'Food',
  serving: 'Serving size',
  calories: 'Calories (kcal)',
  protein: 'Protein (g)',
  carbs: 'Carbs (g)',
  fat: 'Fat (g)',
};

/** "a minute", "30 seconds", "3 minutes": how long to wait, from a Retry-After in seconds (null when the server gave none). */
export function waitText(sec: number | null): string {
  if (sec === null || sec <= 0) return 'a minute';
  if (sec < 60) return sec === 1 ? '1 second' : `${sec} seconds`;
  const m = Math.ceil(sec / 60);
  return m === 1 ? 'a minute' : `${m} minutes`;
}

export const busyText = (sec: number | null): string => `Open Food Facts is busy. Try again in ${waitText(sec)}.`;
export const limitedText = (sec: number | null): string => `Too many lookups just now. Try again in ${waitText(sec)}, or enter it by hand.`;
