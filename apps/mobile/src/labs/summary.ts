import { labResult, type LabReport, type LabTest } from '@plate-and-bar/core';
import { labs } from './content';
import { FLAG_WORD, LABS_SUMMARY_DATE, LABS_SUMMARY_DATE_MISSING, LABS_SUMMARY_EMPTY_VALUE, LABS_SUMMARY_NO_NAME, LABS_SUMMARY_NO_RANGE, LABS_SUMMARY_RANGE, LABS_SUMMARY_TITLE, LABS_SUMMARY_UNIT_UNRECOGNISED } from './copy';

/** File name of the shared summary. No date or name in it: it carries nothing but the word "summary". */
export const LABS_SUMMARY_FILE = 'plate-and-bar-lab-summary.txt';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** One test line: the values as entered, the lab's range as entered, and the app's flag word. A damaged row reads as blanks. */
function testLine(raw: unknown): string {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LabTest, unknown>>;
  const t: LabTest = { name: text(o.name), value: text(o.value), unit: text(o.unit), low: text(o.low), high: text(o.high) };
  const value = [t.value, t.unit].filter(Boolean).join(' ') || LABS_SUMMARY_EMPTY_VALUE;
  const r = labResult(t);
  const parts = [t.low || t.high ? LABS_SUMMARY_RANGE(t.low, t.high) : LABS_SUMMARY_NO_RANGE];
  if (r.unitStatus === 'unrecognised') parts.push(LABS_SUMMARY_UNIT_UNRECOGNISED);
  // A flag of "none" (no range, or no numeric value) says nothing the range part does not, so it adds no word.
  const flag = r.flag === 'none' ? '' : ` - ${FLAG_WORD[r.flag]}`;
  return `- ${t.name || LABS_SUMMARY_NO_NAME}: ${value} (${parts.join('; ')})${flag}`;
}

/**
 * The plain-text "Summary for my doctor" (prototype lab summary, #1088): every saved report with its date and tests, newest
 * last, then the informational disclaimer from content/labs.json. Only what the user typed plus the app's flag word; no
 * diagnosis, no body data, no identifiers. Reports without tests or with a bad shape are skipped. Returns null when nothing is left.
 */
export function buildLabSummary(reports: readonly LabReport[]): string | null {
  const blocks = reports.flatMap((r) => {
    const tests: unknown[] = Array.isArray(r?.tests) ? r.tests : [];
    if (!tests.length) return [];
    return [[`${LABS_SUMMARY_DATE}: ${text(r.date) || LABS_SUMMARY_DATE_MISSING}`, ...tests.map(testLine)].join('\n')];
  });
  if (!blocks.length) return null;
  return [LABS_SUMMARY_TITLE, ...blocks, labs.not_medical_advice].join('\n\n') + '\n';
}
