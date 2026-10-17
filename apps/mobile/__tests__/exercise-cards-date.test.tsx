import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { exInfo, type LiftRecord } from '@plate-and-bar/core';
import { ExerciseCards } from '../src/workout/ExerciseCards';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NAME = 'Machine Shoulder Press';
const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const set = { w: 40, r: 15, rate: 'right' as const };
const lift: LiftRecord = { date: '2026-10-05', sets: [set, set, set], form: 'yes', n: 5, first: '2026-09-01', prev: null, hist: [{ date: '2026-10-05', e: 60 }], pbToast: null };
const ex: ExState = { name: NAME, part: 1, bridge: false, form: 'yes', found: null, skipRamp: false, feel: null, sets: [blankRow()], ramp: [] };

it('answering a card prunes against the real date, not the day being viewed (#721)', async () => {
  const db = memoryDb();
  // 2026-08-01 is 68 days before today but over 90 days before the viewed day; 2026-09-20 is the newest of its group.
  await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments: { dismissed: { 'missed:2026-08-01': true, 'missed:2026-09-20': true } } });
  const rules = { rules: { exclusions: [] }, putSwap: jest.fn(), putRule: jest.fn() } as never;
  await render(withProfile(db, <ExerciseCards ex={ex} info={exInfo(NAME, getCatalog(), undefined, 'gym')} date="2027-06-01" lifts={{ [NAME]: lift }} rules={rules} notify={jest.fn()} now={NOW} where="gym" />));
  fireEvent.press(await screen.findByLabelText(`Not yet, ${NAME}`));
  await waitFor(() => {
    const s = JSON.parse(db.rows.get('user_settings:me') as string) as Settings;
    expect(s.adjustments.dismissed).toEqual({ 'missed:2026-08-01': true, 'missed:2026-09-20': true, [`up:${NAME}:2026-10-05`]: true });
  });
  await waitFor(() => expect(screen.queryByLabelText(`Not yet, ${NAME}`)).toBeNull());
});
