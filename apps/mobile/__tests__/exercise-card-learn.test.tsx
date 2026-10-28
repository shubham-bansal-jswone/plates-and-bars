import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { exInfo, type Suggestion } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const NAME = 'Barbell Bench Press';
const SUG: Suggestion = { mode: 'hold', reps: 8, w: 40, text: '40 kg × 8 reps', reason: 'Same again.' };
const act = new Proxy({}, { get: () => jest.fn() }) as Actions;
const cue = (i: number) => getCatalog().cards[NAME]!.key_cues[i]!;
const steps = () => getCatalog().cards[NAME]!.setup;

function card(o: { learning?: boolean; prior?: number; done?: number; sets?: number } = {}) {
  const sets = Array.from({ length: o.sets ?? 3 }, (_, j) => ({ ...blankRow(), w: '40', r: '8', done: j < (o.done ?? 0) }));
  const ex: ExState = { name: NAME, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets };
  return render(<ExerciseCard ex={ex} info={exInfo(NAME, getCatalog())} sug={SUG} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} learning={o.learning ?? true} prior={o.prior} />);
}
/** Only the shared Disclosure is a 56px row with a top rule; the old lime link was neither. */
const isDisclosure = (el: ReturnType<typeof screen.getByRole>) => {
  expect(StyleSheet.flatten(el.props.style)).toMatchObject({ minHeight: 56, borderTopWidth: 1 });
};
const setup = () => screen.getByRole('button', { name: `Setup steps for ${NAME}` });

describe('Learn mode block', () => {
  it('on the very first session shows the tag, the Setup steps open, and the first cue', async () => {
    await card({ prior: 0 });
    expect(screen.getByText('Learn mode')).toBeTruthy();
    expect(setup().props.accessibilityState).toMatchObject({ expanded: true });
    isDisclosure(setup());
    steps().forEach((x, k) => expect(screen.getByText(`${k + 1}. ${x}`)).toBeTruthy());
    expect(screen.getByText(`Focus this set: ${cue(0)}`)).toBeTruthy();
  });

  it('on a later learn session keeps Setup closed until it is opened, and the user can close it again', async () => {
    await card({ prior: 1 });
    expect(screen.getByText('Learn mode')).toBeTruthy();
    expect(setup().props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByText(`1. ${steps()[0]}`)).toBeNull();
    await fireEvent.press(setup());
    expect(setup().props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText(`1. ${steps()[0]}`)).toBeTruthy();
    await fireEvent.press(setup());
    expect(screen.queryByText(`1. ${steps()[0]}`)).toBeNull();
  });

  it('closes Setup on the first session once a set is done, and moves the cue to the next one', async () => {
    await card({ prior: 0, done: 1 });
    expect(setup().props.accessibilityState).toMatchObject({ expanded: false }); // a disclosure with a closed state, not a bare heading
    isDisclosure(setup());
    expect(screen.queryByText(`1. ${steps()[0]}`)).toBeNull();
    expect(screen.getByText(`Focus this set: ${cue(1)}`)).toBeTruthy();
  });

  it('cycles back to the first cue after the last one', async () => {
    const n = getCatalog().cards[NAME]!.key_cues.length;
    await card({ prior: 1, done: n, sets: n + 1 });
    expect(screen.getByText(`Focus this set: ${cue(0)}`)).toBeTruthy();
  });

  it('is gone once every set is done', async () => {
    await card({ prior: 0, done: 3 });
    expect(screen.queryByText('Learn mode')).toBeNull();
    expect(screen.queryByText(/Focus this set/)).toBeNull();
  });

  it('is gone when the exercise is out of learn mode', async () => {
    await card({ learning: false, prior: 3 });
    expect(screen.queryByText('Learn mode')).toBeNull();
    expect(screen.queryByRole('button', { name: `Setup steps for ${NAME}` })).toBeNull();
    expect(screen.queryByText(/Focus this set/)).toBeNull();
  });
});

describe('Setup guard', () => {
  it('shows no Setup disclosure for an exercise with no setup steps', async () => {
    const c = getCatalog().cards[NAME]!;
    const saved = c.setup;
    c.setup = [];
    try {
      await card({ prior: 0 });
      expect(screen.getByText('Learn mode')).toBeTruthy();
      expect(screen.queryByRole('button', { name: `Setup steps for ${NAME}` })).toBeNull();
    } finally {
      c.setup = saved;
    }
  });
});

describe('what to do next shows without opening anything', () => {
  const warm: [{ w: number; reps: number }, { w: number; reps: number }] = [{ w: 20, reps: 8 }, { w: 30, reps: 4 }];
  const row = (expanded: boolean) => {
    const sets = Array.from({ length: 3 }, () => ({ ...blankRow(), w: '40', r: '8' }));
    const ex: ExState = { name: NAME, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets };
    return render(<ExerciseCard ex={ex} info={exInfo(NAME, getCatalog())} sug={SUG} focus={[]} warm={warm} act={act} infoOf={(n) => exInfo(n, getCatalog())} learning prior={1} expanded={expanded} cards={<></>} />);
  };
  const guide = () => screen.getByRole('button', { name: `Guide and tools for ${NAME}` });

  it('an expanded exercise shows Learn mode, the warm-up and the suggestion with Guide and tools closed', async () => {
    await row(true);
    expect(guide().props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByText('Learn mode')).toBeTruthy();
    expect(screen.getByText(/Warm up first:/)).toBeTruthy();
    expect(screen.getByText('Suggested: 40 kg × 8 reps')).toBeTruthy();
    expect(screen.getByText('Same again.')).toBeTruthy();
  });

  it('a collapsed row shows them too, so a returning user sees them for every exercise', async () => {
    await row(false);
    expect(screen.queryByLabelText(`Guide and tools for ${NAME}`)).toBeNull();
    expect(screen.getByText('Learn mode')).toBeTruthy();
    expect(screen.getByText(/Warm up first:/)).toBeTruthy();
    expect(screen.getByText('Suggested: 40 kg × 8 reps')).toBeTruthy();
    expect(screen.getByText('Same again.')).toBeTruthy();
  });

  it('a collapsed row shows the stall and ladder cards it is given', async () => {
    const sets = [{ ...blankRow(), w: '40', r: '8' }];
    const ex: ExState = { name: NAME, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets };
    await render(<ExerciseCard ex={ex} info={exInfo(NAME, getCatalog())} sug={SUG} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} expanded={false} cards={<Text>No progress in 3 sessions</Text>} />);
    expect(screen.getByText('No progress in 3 sessions')).toBeTruthy();
  });
});
