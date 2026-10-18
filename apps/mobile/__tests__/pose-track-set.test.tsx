import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { exInfo, type Suggestion } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { TrackSet } from '../src/pose/TrackSet';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';
import type { PoseSessionProps } from '../src/pose/pose-session';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

let mockOn = true;
jest.mock('../src/pose/flag', () => ({ ...jest.requireActual('../src/pose/flag'), poseAvailable: () => mockOn }));

// The camera view is a separate chunk: this stand-in records that it was loaded, and when, and what it was given.
const mockLoaded = jest.fn();
const mockProps: PoseSessionProps[] = [];
jest.mock('../src/pose/load', () => {
  const { Pressable, Text: T } = jest.requireActual('react-native');
  const PoseSession = (p: PoseSessionProps) => {
    mockProps.push(p);
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Stub count 8" onPress={() => p.onApply(8)}>
        <T>stub session</T>
      </Pressable>
    );
  };
  return { loadPoseSession: () => (mockLoaded(), Promise.resolve({ PoseSession })) };
});

const SUG: Suggestion = { mode: 'hold', reps: 8, w: 40, text: '40 kg × 8 reps', reason: 'Same again.' };

function card(name: string, done: boolean[], edit = jest.fn()) {
  const sets = done.map((d) => ({ ...blankRow(), w: '10', r: '', done: d }));
  const ex: ExState = { name, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets };
  const act = new Proxy({ edit }, { get: (t, k) => (k in t ? t[k as 'edit'] : jest.fn()) }) as unknown as Actions;
  return { edit, ui: <ExerciseCard ex={ex} info={exInfo(name, getCatalog())} sug={SUG} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} /> };
}

beforeEach(() => {
  mockOn = true;
  mockLoaded.mockClear();
  mockProps.length = 0;
});

describe('"Track this set" on the exercise card', () => {
  it.each(['Goblet Squat', 'Bodyweight Squat'])('shows on %s when the feature is available', async (name) => {
    await render(card(name, [false]).ui);
    expect(screen.getByRole('button', { name: `Track this set of ${name}` })).toBeTruthy();
  });

  it.each(['Hack Squat', 'Leg Press', 'Barbell Bench Press'])('does not show on %s', async (name) => {
    await render(card(name, [false]).ui);
    expect(screen.queryByText('Track this set')).toBeNull();
  });

  it('does not show when the flag is off or there is no camera', async () => {
    mockOn = false;
    await render(card('Goblet Squat', [false]).ui);
    expect(screen.queryByText('Track this set')).toBeNull();
  });

  it('loads the camera view only when the sheet opens', async () => {
    await render(card('Goblet Squat', [false]).ui);
    expect(mockLoaded).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Track this set of Goblet Squat' }));
    expect(await screen.findByText('stub session')).toBeTruthy();
    expect(mockLoaded).toHaveBeenCalledTimes(1);
  });

  it('fills the reps of the first set not done once the user confirms, and closes the sheet', async () => {
    const { edit, ui } = card('Goblet Squat', [true, false, false]);
    await render(ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Track this set of Goblet Squat' }));
    await screen.findByText('stub session');
    expect(mockProps[0]).toMatchObject({ exercise: 'Goblet Squat', setNumber: 2 });
    expect(edit).not.toHaveBeenCalled(); // opening and tracking change nothing
    await fireEvent.press(screen.getByRole('button', { name: 'Stub count 8' }));
    expect(edit).toHaveBeenCalledWith('work', 1, 'r', '8');
    await waitFor(() => expect(screen.queryByText('stub session')).toBeNull());
  });

  it('with every set done, goes to the last one', async () => {
    const { edit, ui } = card('Bodyweight Squat', [true, true]);
    await render(ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Track this set of Bodyweight Squat' }));
    await screen.findByText('stub session');
    await fireEvent.press(screen.getByRole('button', { name: 'Stub count 8' }));
    expect(edit).toHaveBeenCalledWith('work', 1, 'r', '8');
  });

  it('can be closed without applying', async () => {
    const { edit, ui } = card('Goblet Squat', [false]);
    await render(ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Track this set of Goblet Squat' }));
    await screen.findByText('stub session');
    expect(mockProps[0]!.onClose).toBeDefined();
    mockProps[0]!.onClose();
    await waitFor(() => expect(screen.queryByText('stub session')).toBeNull());
    expect(edit).not.toHaveBeenCalled();
  });
});

describe('TrackSet on its own', () => {
  it('renders nothing for a card with no sets', async () => {
    await render(<TrackSet name="Goblet Squat" sets={[]} onApply={jest.fn()} available />);
    expect(screen.queryByText('Track this set')).toBeNull();
  });
});
