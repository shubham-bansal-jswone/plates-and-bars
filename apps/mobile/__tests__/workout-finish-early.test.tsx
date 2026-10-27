import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { focusNode } from '../src/labelscan/focus';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { WorkoutSet } from '../src/workout/types';
import { expand, press } from './disclosure-helpers';
import { memoryDb, withProfile } from './helpers';

// "Complete workout": finish early with only the ticked sets (#1157).
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

jest.mock('../src/labelscan/focus', () => ({ focusNode: jest.fn() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const PUSH_B = ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension'];
const live = (db: ReturnType<typeof memoryDb>) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet).filter((s) => !s.deleted_at);

async function started() {
  const db = memoryDb();
  await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
  await saveProfile(db, { ...profile, where: 'gym' });
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  await fireEvent.press(await screen.findByLabelText('Start Push B'));
  await screen.findByText('Push B');
  return db;
}
const tick = async (name: string) => {
  await expand(name);
  await fireEvent.changeText(screen.getByLabelText(`${name} set 1 kg`), '10');
  await fireEvent.changeText(screen.getByLabelText(`${name} set 1 reps`), '10');
  await press(`Mark ${name} set 1 done`);
};

describe('Complete workout', () => {
  it('is hidden with no set ticked, shows after one, and is hidden again once every set is ticked', async () => {
    await started();
    expect(screen.queryByLabelText('Complete workout')).toBeNull();
    await tick('Barbell Bench Press');
    const b = screen.getByLabelText('Complete workout');
    expect(b).toBeTruthy();
    await press('Complete workout');
    expect(screen.getByText('Finish with 1 of 15 sets?')).toBeTruthy();
    await press('Keep going');
    for (const n of PUSH_B.slice(1)) {
      await expand(n);
      await press(`Remove exercise ${n} from today`);
      await press(`Tap again to remove ${n} from today`);
      await waitFor(() => expect(screen.queryByLabelText(`Mark ${n} set 1 done`)).toBeNull());
    }
    await expand(PUSH_B[0]!);
    while (screen.queryByLabelText(`Remove last set of ${PUSH_B[0]}`)) await press(`Remove last set of ${PUSH_B[0]}`);
    expect(screen.getByText('Session done')).toBeTruthy();
    expect(screen.queryByLabelText('Complete workout')).toBeNull();
  });

  it('Keep going changes nothing', async () => {
    const db = await started();
    await tick('Barbell Bench Press');
    const before = live(db).length;
    await press('Complete workout');
    await press('Keep going');
    expect(screen.getByLabelText('Complete workout')).toBeTruthy();
    expect(screen.queryByText('Session done')).toBeNull();
    expect(screen.getByText('1 of 15 sets done, 100 kg lifted')).toBeTruthy();
    expect(live(db)).toHaveLength(before);
  });

  it('Confirm removes only the unticked sets and untouched exercises, keeps ratings, shows the panel and closes the rest dock', async () => {
    const db = await started();
    await tick('Barbell Bench Press');
    await press('Barbell Bench Press set 1: Easy');
    await tick('Machine Shoulder Press');
    expect(screen.getByTestId('rest-title')).toBeTruthy();
    await press('Complete workout');
    expect(screen.getByText('Finish with 2 of 15 sets?')).toBeTruthy();
    expect(screen.getByText('Unticked sets are removed from today.')).toBeTruthy();
    await press('Confirm');
    expect(await screen.findByText('Session done')).toBeTruthy();
    expect(screen.getByLabelText('Sets: 2/2')).toBeTruthy();
    expect(screen.getByLabelText('Exercises: 2')).toBeTruthy();
    expect(screen.getByText('Felt: Easy')).toBeTruthy();
    expect(screen.queryByTestId('rest-title')).toBeNull();
    expect(screen.queryByLabelText('Complete workout')).toBeNull();
    await waitFor(() => expect(live(db).filter((s) => s.kind === 'work')).toHaveLength(2));
    const rows = live(db);
    expect(rows.every((s) => s.done)).toBe(true);
    expect(rows.find((s) => s.exercise === 'Barbell Bench Press')?.rate).toBe('easy');
    expect(rows.some((s) => s.exercise === 'Pec Deck Fly')).toBe(false);
  });

  it('moves focus to the question, back to the button on Keep going, and to the Session done heading on Confirm', async () => {
    await started();
    await tick('Barbell Bench Press');
    const focus = jest.mocked(focusNode);
    focus.mockClear();
    await press('Complete workout');
    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ props: expect.objectContaining({ testID: 'finish-prompt' }) }));
    await press('Keep going');
    expect(focus).toHaveBeenCalledTimes(2);
    await press('Complete workout');
    await press('Confirm');
    await screen.findByText('Session done');
    const last = focus.mock.calls[focus.mock.calls.length - 1]![0] as unknown as { props: { accessibilityRole?: string; children?: unknown } };
    expect(last.props.accessibilityRole).toBe('header');
  });
});
