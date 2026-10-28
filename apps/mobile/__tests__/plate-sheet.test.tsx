import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { exInfo, type Suggestion } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { ExerciseDetail } from '../src/library/ExerciseDetail';
import { getLibrary } from '../src/library/exercises';
import { PlateSheet } from '../src/workout/PlateSheet';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';
import { PlateSettingsProvider, loadPlateSettings, parsePlateSettings } from '../src/settings/plateSettings';
import { WeightUnitProvider } from '../src/settings/weightUnit';
import { memoryDb } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const SUG: Suggestion = { mode: 'new', reps: 8, text: '', reason: '' };
const state = (name: string, w: string): ExState => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, ramp: [], sets: [{ ...blankRow(), w }] });

async function card(name: string, w: string, edit = jest.fn(), unit: 'kg' | 'lb' = 'kg') {
  const act0 = new Proxy({}, { get: (_t, k) => (k === 'edit' ? edit : jest.fn()) }) as Actions;
  const db = memoryDb();
  if (unit === 'lb') db.rows.set('settings:device.weight_unit', 'lb');
  await render(
    <WeightUnitProvider db={db}>
      <PlateSettingsProvider db={db}>
        <ExerciseCard ex={state(name, w)} info={exInfo(name, getCatalog())} sug={SUG} focus={[]} warm={null} act={act0} prior={1} infoOf={(n) => exInfo(n, getCatalog())} />
      </PlateSettingsProvider>
    </WeightUnitProvider>,
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 0)))); // the stored unit is read
  return { db, edit };
}

describe('plate calculator sheet (#1176)', () => {
  it('opens from a barbell set row only', async () => {
    await card('Barbell Bench Press', '100');
    expect(screen.getByLabelText('Plates for Barbell Bench Press set 1')).toBeTruthy();
  });

  it('is not offered on a dumbbell or machine exercise', async () => {
    await card('Dumbbell Bench Press', '20');
    expect(screen.queryByLabelText(/^Plates for/)).toBeNull();
  });

  it('shows 25 and 15 per side for 100 kg, with the stack labelled for a screen reader', async () => {
    await card('Barbell Bench Press', '100');
    await fireEvent.press(screen.getByLabelText('Plates for Barbell Bench Press set 1'));
    expect(screen.getByText('Per side: 25, 15 kg')).toBeTruthy();
    expect(screen.queryAllByLabelText('Per side: 25, 15 kg')).toHaveLength(0); // the stack is hidden: one announcement, the line
    expect(screen.queryByTestId('plate-stack')).toBeNull(); // hidden from queries too, as from a screen reader
    expect(screen.getByTestId('plate-stack', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(/Loaded: 100 kg\. Exactly the target\./)).toBeTruthy();
    expect(screen.queryByText(/can’t be loaded/)).toBeNull();
  });

  it('shows two 45 lb plates per side for 225 lb', async () => {
    await card('Barbell Bench Press', String(225 * 0.45359237), jest.fn(), 'lb');
    await fireEvent.press(screen.getByLabelText('Plates for Barbell Bench Press set 1'));
    expect(screen.getByText('Per side: 45, 45 lb')).toBeTruthy();
    expect(screen.getByText(/Loaded: 225 lb\./)).toBeTruthy();
  });

  it('uses the suggestion when nothing is typed, and an empty target asks for one', async () => {
    await render(<PlateSheet name="Barbell Squat" targetKg={null} onClose={() => undefined} />);
    expect(screen.getByText('Type a weight to see the plates.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Target weight in kg'), '60');
    expect(screen.getByText('Per side: 20 kg')).toBeTruthy();
  });

  it('offers the nearest loadable weights when the target is not loadable, and applying one stores exact kg', async () => {
    const { edit } = await card('Barbell Bench Press', '101');
    await fireEvent.press(screen.getByLabelText('Plates for Barbell Bench Press set 1'));
    expect(screen.getByText(/1 kg short of the target\./)).toBeTruthy();
    expect(screen.getByText('Below: 100 kg')).toBeTruthy();
    expect(screen.getByText('Above: 102.5 kg')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Use 102.5 kg, above the target, on this set'));
    expect(edit).toHaveBeenCalledWith('work', 0, 'w', '102.5');
    expect(screen.queryByText('Above: 102.5 kg')).toBeNull(); // the sheet closed
  });

  it('applies a lb neighbour as exact kg, not as the lb number', async () => {
    const { edit } = await card('Barbell Bench Press', String(226 * 0.45359237), jest.fn(), 'lb');
    await fireEvent.press(screen.getByLabelText('Plates for Barbell Bench Press set 1'));
    await fireEvent.press(screen.getByLabelText('Use 230 lb, above the target, on this set'));
    expect(edit).toHaveBeenCalledWith('work', 0, 'w', String(230 * 0.45359237));
  });

  it('on a set row, a target under the bar offers the bar alone and applies it as exact kg', async () => {
    const { edit } = await card('Barbell Bench Press', '10');
    await fireEvent.press(screen.getByLabelText('Plates for Barbell Bench Press set 1'));
    expect(screen.getByText('Bar only, 20 kg')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Use 20 kg, the bar only, on this set'));
    expect(edit).toHaveBeenCalledWith('work', 0, 'w', '20');
  });

  it('shows the link only on the current set', async () => {
    const edit = jest.fn();
    const act0 = new Proxy({}, { get: (_t, k) => (k === 'edit' ? edit : jest.fn()) }) as Actions;
    const ex = state('Barbell Bench Press', '100');
    ex.sets = [{ ...blankRow(), w: '100', done: true }, { ...blankRow(), w: '100' }, { ...blankRow(), w: '100' }];
    await render(<ExerciseCard ex={ex} info={exInfo(ex.name, getCatalog())} sug={SUG} focus={[]} warm={null} act={act0} prior={1} infoOf={(n) => exInfo(n, getCatalog())} />);
    expect(screen.queryByLabelText('Plates for Barbell Bench Press set 1')).toBeNull();
    expect(screen.getByLabelText('Plates for Barbell Bench Press set 2')).toBeTruthy();
    expect(screen.queryByLabelText('Plates for Barbell Bench Press set 3')).toBeNull();
  });

  it('a bar weight that is not one number, or is out of range, shows an error and is not saved', async () => {
    const db = memoryDb();
    await render(
      <WeightUnitProvider db={db}>
        <PlateSettingsProvider db={db}>
          <PlateSheet name="Barbell Squat" targetKg={60} onClose={() => undefined} />
        </PlateSettingsProvider>
      </WeightUnitProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Bar and plates settings'));
    for (const bad of ['abc', '20.5.', '', '1001']) {
      await fireEvent.changeText(screen.getByLabelText('Bar weight in kg'), bad);
      expect(screen.getByText('Type one number from 0 to 1000, like 20.')).toBeTruthy();
    }
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(db.rows.has('settings:device.plates')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Bar weight in kg'), '15');
    expect(screen.queryByText(/Type one number from 0/)).toBeNull();
    await waitFor(async () => expect((await loadPlateSettings(db)).kg.bar).toBe(15));
  });

  it('an invalid target shows its error and no empty hint', async () => {
    await render(<PlateSheet name="Barbell Squat" targetKg={null} onClose={() => undefined} />);
    await fireEvent.changeText(screen.getByLabelText('Target weight in kg'), 'abc');
    expect(screen.getByText('Type one number, like 100.')).toBeTruthy();
    expect(screen.queryByText('Type a weight to see the plates.')).toBeNull();
  });

  it('a target lighter than the bar says so', async () => {
    await render(<PlateSheet name="Barbell Squat" targetKg={10} onClose={() => undefined} />);
    expect(screen.getByText('Bar only, 20 kg')).toBeTruthy();
    expect(screen.getByText(/Lighter than the bar/)).toBeTruthy();
  });

  it('a library detail of a barbell opens it, with no apply button', async () => {
    const bar = getLibrary().find((e) => e.type === 'barbell')!;
    await render(<ExerciseDetail exercise={bar} onBack={() => undefined} />);
    await fireEvent.press(screen.getByLabelText(`Plate calculator for ${bar.name}`));
    await fireEvent.changeText(screen.getByLabelText('Target weight in kg'), '101');
    expect(screen.getByText('Above: 102.5 kg')).toBeTruthy();
    expect(screen.queryByLabelText(/on this set$/)).toBeNull();
  });

  it('a library detail of other equipment has no plate calculator', async () => {
    const other = getLibrary().find((e) => e.type === 'dumbbell')!;
    await render(<ExerciseDetail exercise={other} onBack={() => undefined} />);
    expect(screen.queryByLabelText(/^Plate calculator for/)).toBeNull();
  });

  it('bar weight and plates persist on the device and change the answer', async () => {
    const db = memoryDb();
    const sheet = () => (
      <WeightUnitProvider db={db}>
        <PlateSettingsProvider db={db}>
          <PlateSheet name="Barbell Squat" targetKg={60} onClose={() => undefined} />
        </PlateSettingsProvider>
      </WeightUnitProvider>
    );
    const first = await render(sheet());
    await fireEvent.press(screen.getByLabelText('Bar and plates settings'));
    await fireEvent.changeText(screen.getByLabelText('Bar weight in kg'), '15');
    await fireEvent.press(screen.getByLabelText('Plate 25 kg'));
    await fireEvent.press(screen.getByLabelText('Plate 20 kg'));
    expect(screen.getByText('Per side: 15, 5, 2.5 kg')).toBeTruthy(); // (60 - 15) / 2 = 22.5 without 25 and 20
    await waitFor(async () => expect((await loadPlateSettings(db)).kg).toEqual({ bar: 15, plates: [15, 10, 5, 2.5, 1.25] }));
    await act(async () => first.unmount());
    await render(sheet());
    await waitFor(() => expect(screen.getByText('Per side: 15, 5, 2.5 kg')).toBeTruthy());
  });

  it('a damaged stored value falls back to the defaults', () => {
    expect(parsePlateSettings('nope').kg).toEqual({ bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] });
    expect(parsePlateSettings('{"lb":{"bar":-1,"plates":[1]}}').lb.bar).toBe(45);
  });
});
