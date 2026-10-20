import type { LabFlag, LabReportError } from '@plate-and-bar/core';

// Lab reports screen text (prototype `labsShellHtml`, `labSheet`, `renderLabs`, the `lab-*` actions). The medical wording (tips and notices) is in content/labs.json.
export const LABS_TITLE = 'Lab reports';
export const LABS_ADD = 'Add a report';
export const LABS_SHEET_TITLE = 'Add a lab report';
export const LABS_DATE_LABEL = 'Report date';
export const LABS_DATE_PLACEHOLDER = 'YYYY-MM-DD';
export const LABS_ADD_TEST = 'Add another test';
export const LABS_SAVE = 'Values are correct, save';
export const LABS_DISCARD = 'Discard';
export const LABS_SEEN_DOCTOR = 'I’ve seen my doctor';
export const LABS_PRIVATE = 'Kept only on this device, never uploaded.';
export const LABS_SAVED = 'Report saved on this device';
export const LABS_SAVED_RED = 'Saved. One result needs a doctor’s review.';
export const LABS_CLEARED = 'Thanks. Normal targets are back.';
export const LABS_DELETED = 'Reports deleted';
export const LABS_DELETE = 'Delete all reports';
/** Second tap of the delete: it cannot be undone. */
export const LABS_DELETE_AGAIN = 'Tap again to delete all reports';
export const LABS_LOAD_FAILED = 'Couldn’t read your lab reports. Try again.';
export const LABS_SAVE_FAILED = 'Couldn’t save the lab report. Try again.';
export const LABS_ALL = (n: number): string => `All results (${n})`;
export const LABS_COUNT = (n: number): string => `${n} report${n > 1 ? 's' : ''} saved on this device.`;
export const LABS_LATEST = (date: string): string => `Report: ${date}`;
export const LABS_RANGE = (low: string, high: string, flag: LabFlag): string => `Lab range ${low || '–'} to ${high || '–'}${flag === 'red' ? ', far outside' : flag === 'high' || flag === 'low' ? `, ${flag}` : ''}`;
export const LABS_TREND = (points: readonly { date: string; value: string }[]): string => `Trend: ${points.map((p) => `${p.date}: ${p.value}`).join(', ')}`;
export const LABS_TEST_N = (n: number): string => `Test ${n}`;
export const LABS_REMOVE_TEST = (n: number): string => `Remove test ${n}`;
export const LABS_FIELD = { name: 'Test name', value: 'Value', unit: 'Unit', low: 'Lab low limit', high: 'Lab high limit' } as const;
export const LABS_PLACEHOLDER = { name: 'e.g. LDL cholesterol', value: 'Value', unit: 'Unit, e.g. mg/dL', low: 'Low', high: 'High' } as const;

/** The flag as a word, so no flag depends on colour alone. */
export const FLAG_WORD: Record<LabFlag, string> = { red: 'Needs a doctor’s review', high: 'High', low: 'Low', ok: 'Within the lab’s range', none: 'No range printed' };

/** Inline form errors, by the code core's `validateLabReport` returns. */
export const LAB_ERRORS: Record<LabReportError, string> = {
  bad_date: 'Enter the report date as YYYY-MM-DD.',
  no_tests: 'Add at least one test.',
  too_many_tests: 'A report can hold at most 80 tests.',
  name_missing: 'Enter the test name as printed on your report.',
  name_too_long: 'The test name is too long.',
  value_not_number: 'Enter the value as a number, like 5.4.',
  low_not_number: 'Enter the lab’s low limit as a number, or leave it empty.',
  high_not_number: 'Enter the lab’s high limit as a number, or leave it empty.',
  unit_too_long: 'The unit is too long.',
  unit_missing: 'Enter the unit printed on your report, like mg/dL. This test needs one.',
};
