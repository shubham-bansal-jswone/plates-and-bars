import { SCREEN_QUESTIONS, setupSummary, screenFlag, type ScreenAnswer } from '@plate-and-bar/core';
import { SCREEN_Q } from '../src/setup/copy';

// The questions this copy replaced (#716), in answer order. Each new question takes over the answer slot of the
// old one at the same index, so the stored answers, the screening flag and the results cannot change.
const REPLACED = [
  'Has a doctor told you that you have a heart condition or high blood pressure?',
  'Do you get chest pain at rest, during daily activities or when you exercise?',
  'In the past 12 months, have you lost balance from dizziness or lost consciousness?',
  'Do you have another long-term medical condition, or take prescribed medicine for one?',
  'Do you have a bone, joint or muscle problem that more activity could make worse?',
  'Has a doctor said you should only exercise under medical supervision?',
];
const TOPICS = [/heart.*blood pressure/i, /chest/i, /fainted.*dizzy/i, /long-term.*medication/i, /bone, joint or soft-tissue/i, /supervision/i];

describe('health-check copy', () => {
  it('keeps six questions, each in the same slot as the question it replaces, in new words', () => {
    expect(SCREEN_Q).toHaveLength(SCREEN_QUESTIONS);
    expect(SCREEN_Q).toHaveLength(REPLACED.length);
    SCREEN_Q.forEach((q, i) => {
      expect(q).not.toBe(REPLACED[i]);
      expect(q).toMatch(TOPICS[i]);
      expect(q).not.toMatch(/PAR-Q/i);
    });
    expect(new Set(SCREEN_Q).size).toBe(SCREEN_Q.length);
  });

  it('flags and notes the result exactly when any answer is yes, for all 64 answer combinations', () => {
    const base = { sex: 'male', age: 30, height_cm: 175, weight_kg: 75, activity: 'light', where: 'gym', days: 3, minutes: 45, goal: 'maintain', pace: 'moderate', special: null } as const;
    for (let m = 0; m < 2 ** SCREEN_QUESTIONS; m++) {
      const screen: ScreenAnswer[] = Array.from({ length: SCREEN_QUESTIONS }, (_, i) => (m >> i & 1 ? 'yes' : 'no'));
      const anyYes = m !== 0;
      expect(screenFlag({ screen } as never)).toBe(anyYes);
      expect(setupSummary({ ...base, screen } as never).notes.includes('screen')).toBe(anyYes);
    }
  });
});
