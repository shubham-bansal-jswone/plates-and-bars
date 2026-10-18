import { num, sleepEntry } from '@plate-and-bar/core';
import { SLEEP_BAD, STEPS_BAD } from './copy';

const isNumber = (text: string): boolean => Number.isFinite(Number(text.trim()));

/** What the day note holds now (a device count may be on it). */
export interface StoredSteps {
  steps: number | null;
  steps_source?: 'manual' | 'device' | null;
}

export type StepsSleepSave =
  | { kind: 'bad'; message: string }
  | { kind: 'ok'; steps: number | null; steps_source: 'manual' | 'device' | null; sleep: number | null; stepsChanged: boolean };

/**
 * What the Steps and Sleep boxes save on the day note, one rule for Progress and for Food's burn details: steps a whole
 * number of 0 or more (0 is a real count, #303), sleep 0-24 h (#247), an empty box clears its value. Steps left as they were
 * (`stepsChanged` false) keep their source, so saving the sleep does not relabel a phone count as typed (#300), and the caller
 * leaves steps out of the write so a newer count the sensor stored meanwhile is not overwritten.
 */
export function stepsSleepSave(stepsText: string, sleepText: string, stored?: StoredSteps | null): StepsSleepSave {
  if (stepsText.trim() && !isNumber(stepsText)) return { kind: 'bad', message: STEPS_BAD };
  const steps = stepsText.trim() ? Math.round(num(stepsText)) : null;
  const slept = sleepEntry(sleepText);
  if (steps !== null && !(steps >= 0)) return { kind: 'bad', message: STEPS_BAD };
  if (slept.kind === 'bad') return { kind: 'bad', message: SLEEP_BAD };
  const stepsChanged = steps !== (stored?.steps ?? null);
  const steps_source = steps === null ? null : stepsChanged ? 'manual' : (stored?.steps_source ?? 'manual');
  return { kind: 'ok', steps, steps_source, sleep: slept.kind === 'save' ? slept.h : null, stepsChanged };
}
