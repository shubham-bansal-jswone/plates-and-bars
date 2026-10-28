import { labResult, type LabReport, type LabTest } from '@plate-and-bar/core';
import { labs } from './content';
import { FLAG_WORD, LABS_SUMMARY_EMPTY_VALUE, LABS_SUMMARY_TITLE } from './copy';

/** File name of the shared summary. No date or name in it: it carries nothing but the word "summary". */
export const LABS_SUMMARY_FILE = 'plate-and-bar-lab-summary.txt';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** One test line: the values as entered, the lab's range as entered, and the app's flag word. A damaged row reads as blanks. */
function testLine(raw: unknown): string {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LabTest, unknown>>;
  const t: LabTest = { name: text(o.name), value: text(o.value), unit: text(o.unit), low: text(o.low), high: text(o.high) };
  const value = [t.value, t.unit].filter(Boolean).join(' ') || LABS_SUMMARY_EMPTY_VALUE;
  const range = t.low || t.high ? `lab range ${t.low || '–'} to ${t.high || '–'}` : 'no range entered';
  return `- ${t.name || 'Unnamed test'}: ${value} (${range}) - ${FLAG_WORD[labResult(t).flag]}`;
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
    return [[`Report date: ${text(r.date) || 'not entered'}`, ...tests.map(testLine)].join('\n')];
  });
  if (!blocks.length) return null;
  return [LABS_SUMMARY_TITLE, ...blocks, labs.not_medical_advice].join('\n\n') + '\n';
}
