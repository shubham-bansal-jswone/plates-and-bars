import { num, sleepEntry } from '@plate-and-bar/core';
import { SLEEP_BAD, STEPS_BAD } from './copy';

const isNumber = (text: string): boolean => Number.isFinite(Number(text.trim()));

export type StepsSleepSave = { kind: 'bad'; message: string } | { kind: 'ok'; steps: number | null; steps_source: 'manual' | null; sleep: number | null };

/**
 * What the Steps and Sleep boxes save on the day note, one rule for Progress and for Food's burn details: steps a whole
 * number of 0 or more (0 is a real count, #303), sleep 0-24 h (#247), an empty box clears its value.
 */
export function stepsSleepSave(stepsText: string, sleepText: string): StepsSleepSave {
  if (stepsText.trim() && !isNumber(stepsText)) return { kind: 'bad', message: STEPS_BAD };
  const steps = stepsText.trim() ? Math.round(num(stepsText)) : null;
  const slept = sleepEntry(sleepText);
  if (steps !== null && !(steps >= 0)) return { kind: 'bad', message: STEPS_BAD };
  if (slept.kind === 'bad') return { kind: 'bad', message: SLEEP_BAD };
  return { kind: 'ok', steps, steps_source: steps === null ? null : 'manual', sleep: slept.kind === 'save' ? slept.h : null };
}
