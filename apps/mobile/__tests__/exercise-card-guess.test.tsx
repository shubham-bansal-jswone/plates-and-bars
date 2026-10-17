import { render, screen } from '@testing-library/react-native';
import { exInfo, type ExInfo, type LiftRecord, type Suggestion } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const NEW: Suggestion = { mode: 'new', reps: 8, text: '', reason: '' };
const act = new Proxy({}, { get: () => jest.fn() }) as Actions;
const lift = (w: number): LiftRecord => ({ date: '2026-10-01', sets: [{ w, r: 8 }] });

function state(name: string, o: Partial<ExState> = {}): ExState {
  return { name, part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, ramp: [], sets: [{ ...blankRow() }], ...o };
}

async function card(name: string, o: { lifts?: Record<string, LiftRecord>; ex?: Partial<ExState>; sug?: Suggestion; infoOf?: (n: string) => ExInfo } = {}) {
  const info = exInfo(name, getCatalog());
  await render(<ExerciseCard ex={state(name, o.ex)} info={info} sug={o.sug ?? NEW} focus={[]} warm={null} act={act} lifts={o.lifts} infoOf={o.infoOf ?? ((n) => exInfo(n, getCatalog()))} />);
}

describe('first-time rough guess', () => {
  it('shows the guess from a related lift, formatted for both exercises', async () => {
    await card('Barbell Bench Press', { lifts: { 'Dumbbell Bench Press': lift(20) } });
    expect(screen.getByText('Rough guess from your Dumbbell Bench Press (20 kg each): about 45 kg. Use the ramp to confirm.')).toBeTruthy();
  });

  it('goes the other way too, with each-hand weights on the target', async () => {
    await card('Dumbbell Bench Press', { lifts: { 'Barbell Bench Press': lift(60) } });
    expect(screen.getByText('Rough guess from your Barbell Bench Press (60 kg): about 25 kg each. Use the ramp to confirm.')).toBeTruthy();
  });

  it("labels the paired lift with the caller's info, so the user's overrides show", async () => {
    const infoOf = (n: string): ExInfo => ({ ...exInfo(n, getCatalog()), type: 'barbell' });
    await card('Barbell Bench Press', { lifts: { 'Dumbbell Bench Press': lift(20) }, infoOf });
    expect(screen.getByText(/Rough guess from your Dumbbell Bench Press \(20 kg\):/)).toBeTruthy();
  });

  it('shows nothing without a related lift', async () => {
    await card('Barbell Bench Press', { lifts: { 'Lat Pulldown': lift(40) } });
    expect(screen.getByText('First time: find your weight')).toBeTruthy();
    expect(screen.queryByText(/Rough guess/)).toBeNull();
  });

  it('shows nothing when the related lift has no weight', async () => {
    await card('Barbell Bench Press', { lifts: { 'Dumbbell Bench Press': lift(0) } });
    expect(screen.queryByText(/Rough guess/)).toBeNull();
  });

  it('is part of the first-time guide only: gone once the ramp has started or the exercise has a suggestion', async () => {
    const lifts = { 'Dumbbell Bench Press': lift(20) };
    await card('Barbell Bench Press', { lifts, ex: { ramp: [{ ...blankRow() }] } });
    expect(screen.queryByText(/Rough guess/)).toBeNull();
    await screen.unmount();
    await card('Barbell Bench Press', { lifts, sug: { mode: 'hold', reps: 8, w: 40, text: '40 kg × 8 reps', reason: 'Same again.' } });
    expect(screen.queryByText(/Rough guess/)).toBeNull();
  });
});

describe('ladder step line', () => {
  it('shows the ladder and the step under the rest line', async () => {
    await card('Barbell Bench Press');
    expect(screen.getByText(/Chest press ladder: step 3 of 3/)).toBeTruthy();
    expect(screen.getByText(/Rest .* between sets Chest press ladder: step 3 of 3/)).toBeTruthy();
  });

  it('counts the step from the start of the ladder', async () => {
    await card('Machine Chest Press');
    expect(screen.getByText(/Chest press ladder: step 1 of 3/)).toBeTruthy();
  });

  it('is hidden for an exercise on no ladder', async () => {
    await card('Pec Deck Fly');
    expect(screen.queryByText(/ladder: step/)).toBeNull();
  });
});
