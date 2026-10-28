import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SyncContext } from '../src/sync/SyncProvider';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { saveHold, saveReport } from '../src/db/labs';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { labs } from '../src/labs/content';
import { memoryDb, withProfile } from './helpers';

void SyncContext;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
let mockN = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockN).padStart(12, '0')}` }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // 8 Oct 2026
const realFlag = process.env.EXPO_PUBLIC_LAB_REPORTS;
beforeEach(() => {
  process.env.EXPO_PUBLIC_LAB_REPORTS = '1';
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_LAB_REPORTS;
  else process.env.EXPO_PUBLIC_LAB_REPORTS = realFlag;
});

const profile = () => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '82', activity: 'sitting', where: 'gym', days: 4, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
type Db = ReturnType<typeof memoryDb>;
async function setup(seed?: (db: Db) => Promise<void>) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await seed?.(db);
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}
const keys = (db: Db) => [...db.rows.keys()].filter((k) => k.startsWith('lab_store:'));
const hold = (db: Db) => (db.rows.has('lab_store:hold') ? JSON.parse(db.rows.get('lab_store:hold')!) : null);
const test = (name: string, value: string, unit: string, low = '', high = '') => ({ name, value, unit, low, high });
const rep = (id: string, date: string, tests: ReturnType<typeof test>[]) => ({ id, date, tests });

async function fillRow(i: number, v: { name?: string; value?: string; unit?: string; low?: string; high?: string }) {
  const label = { name: 'Test name', value: 'Value', unit: 'Unit', low: 'Lab low limit', high: 'Lab high limit' } as const;
  for (const k of Object.keys(v) as (keyof typeof label)[]) await fireEvent.changeText(screen.getByLabelText(`${label[k]}, test ${i}`), v[k]!);
}

describe('flag off', () => {
  it('has no entry point, reads nothing and holds nothing, even with a stored hold', async () => {
    delete process.env.EXPO_PUBLIC_LAB_REPORTS;
    const db = await setup(async (d) => saveHold(d, { on: true, since: '2026-10-01' }));
    expect(screen.queryByRole('header', { name: 'Lab reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a report' })).toBeNull();
    expect(screen.queryByText(labs.hold_title)).toBeNull();
    expect(keys(db)).toEqual(['lab_store:hold']); // untouched
  });
});

describe('Lab reports section (flag on)', () => {
  it('shows the intro, the not-medical-advice line and an Add a report button', async () => {
    await setup();
    expect(await screen.findByRole('header', { name: 'Lab reports' })).toBeTruthy();
    expect(screen.getByText(labs.not_medical_advice)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a report' })).toBeTruthy();
  });

  it('requires a unit for a test whose name matches a marker, and announces the error inline', async () => {
    const db = await setup();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    await fillRow(1, { name: 'LDL cholesterol', value: '120' });
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the unit printed on your report, like mg/dL. This test needs one.');
    expect(keys(db)).toEqual([]);
    await fillRow(1, { unit: 'mg/dL' });
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    await waitFor(() => expect(keys(db).length).toBe(1));
    expect(screen.getByText('Report saved on this device')).toBeTruthy();
  });

  it('shows the other validation errors: a bad date, a missing name, a value that is not a number', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    await fireEvent.changeText(screen.getByLabelText('Report date'), '8/10/2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    expect(await screen.findByText('Enter the report date as YYYY-MM-DD.')).toBeTruthy();
    expect(screen.getByText('Enter the test name as printed on your report.')).toBeTruthy();
    await fillRow(1, { name: 'Something', value: 'abc' });
    expect(screen.getByText('Enter the value as a number, like 5.4.')).toBeTruthy();
  });

  it('the date and the row each mark their fields invalid and point at their error, only while it shows', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    expect(screen.getByLabelText('Report date').props['aria-invalid']).toBeUndefined();
    await fireEvent.changeText(screen.getByLabelText('Report date'), '8/10/2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    const idOf = (t: string) => screen.getByText(t).props.nativeID as string;
    const dateErr = 'Enter the report date as YYYY-MM-DD.';
    const date = screen.getByLabelText('Report date');
    expect(date.props['aria-invalid']).toBe(true);
    expect(date.props.accessibilityHint).toBe(dateErr);
    expect(idOf(dateErr)).toMatch(/\S/);
    expect(date.props['aria-describedby']).toBe(idOf(dateErr));
    const rowErr = 'Enter the test name as printed on your report.';
    const ALL = ['Test name', 'Value', 'Unit', 'Lab low limit', 'Lab high limit'];
    // The error names the test name only: that field is invalid and linked, the other four are not.
    for (const f of ALL) {
      const el = screen.getByLabelText(`${f}, test 1`);
      const named = f === 'Test name';
      expect(el.props['aria-invalid']).toBe(named ? true : undefined);
      expect(el.props.accessibilityHint).toBe(named ? rowErr : undefined);
      expect(el.props['aria-describedby']).toBe(named ? idOf(rowErr) : undefined);
    }
    expect(idOf(rowErr)).not.toBe(idOf(dateErr));
    await fireEvent.changeText(screen.getByLabelText('Report date'), '2026-10-08');
    expect(screen.getByLabelText('Report date').props['aria-describedby']).toBeUndefined();
    expect(screen.getByLabelText('Report date').props['aria-invalid']).toBeUndefined();
    // A bad value moves the mark to the value field alone.
    await fillRow(1, { name: 'Glucose', value: 'abc' });
    const bad = 'Enter the value as a number, like 5.4.';
    for (const f of ALL) {
      const el = screen.getByLabelText(`${f}, test 1`);
      const named = f === 'Value';
      expect(el.props['aria-invalid']).toBe(named ? true : undefined);
      expect(el.props['aria-describedby']).toBe(named ? idOf(bad) : undefined);
    }
    await fillRow(1, { value: '5', unit: 'mmol/L' });
    for (const f of ALL) expect(screen.getByLabelText(`${f}, test 1`).props['aria-describedby']).toBeUndefined();
  });

  it('every field has a label and a test can be added and removed', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add another test' }));
    for (const f of ['Test name', 'Value', 'Unit', 'Lab low limit', 'Lab high limit']) for (const i of [1, 2]) expect(screen.getByLabelText(`${f}, test ${i}`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove test 2' }));
    expect(screen.queryByLabelText('Value, test 2')).toBeNull();
  });

  it('shows red, high, low and none results with a flag word, the right tip, and the range', async () => {
    await setup(async (d) =>
      saveReport(d, rep('r1', '2026-10-01', [
        test('Fasting glucose', '250', 'mg/dL', '70', '100'), // red
        test('LDL cholesterol', '150', 'mg/dL', '0', '100'), // high, with a tip
        test('Vitamin D', '10', 'ng/mL', '30', '100'), // low, with a tip
        test('Sodium', '150', 'mmol/L', '135', '145'), // high, no marker: generic
        test('Albumin', '4', 'g/dL'), // none
      ])),
    );
    expect(await screen.findByText('Fasting glucose: 250 mg/dL')).toBeTruthy();
    expect(screen.getByText('Needs a doctor’s review')).toBeTruthy();
    expect(screen.getAllByText(labs.red_notice)).toHaveLength(1);
    expect(screen.getByText('Lab range 70 to 100, far outside')).toBeTruthy();
    expect(screen.getByText('LDL cholesterol: 150 mg/dL')).toBeTruthy();
    expect(screen.getAllByText('High')).toHaveLength(2); // LDL and sodium
    expect(screen.getByText(labs.markers.ldl!.high!)).toBeTruthy();
    expect(screen.getByText('Vitamin D: 10 ng/mL')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getByText(labs.markers.vitamin_d!.low!)).toBeTruthy();
    expect(screen.getByText('Sodium: 150 mmol/L')).toBeTruthy();
    expect(screen.getByText(labs.generic_notice)).toBeTruthy();
    expect(screen.queryByText(/Albumin/)).toBeNull(); // not flagged: only in All results
    await fireEvent.press(screen.getByRole('button', { name: 'All results (5)' }));
    expect(screen.getByText('Albumin')).toBeTruthy();
    expect(screen.getByText('4 g/dL · No range printed')).toBeTruthy();
  });

  it('says "unit not recognised" for a matched marker in an unknown unit, and never marks it red', async () => {
    await setup(async (d) => saveReport(d, rep('r1', '2026-10-01', [test('Fasting glucose', '250', 'bananas', '70', '100')])));
    expect(await screen.findByText('Fasting glucose: 250 bananas')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText(labs.unit_unrecognised)).toBeTruthy();
    expect(screen.queryByText(labs.red_notice)).toBeNull();
  });

  it('says everything is in range when nothing is flagged', async () => {
    await setup(async (d) => saveReport(d, rep('r1', '2026-10-01', [test('LDL cholesterol', '90', 'mg/dL', '0', '100')])));
    expect(await screen.findByText(labs.all_within_range)).toBeTruthy();
  });

  it('shows the trend of a test across reports, and lets you pick an older report', async () => {
    await setup(async (d) => {
      await saveReport(d, rep('r1', '2026-08-01', [test('LDL cholesterol', '160', 'mg/dL', '0', '100')]));
      await saveReport(d, rep('r2', '2026-10-01', [test('LDL cholesterol', '150', 'mg/dL', '0', '100')]));
    });
    expect(await screen.findByText('Trend: 1 Aug: 160, 1 Oct: 150')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show the report from 2026-08-01' }));
    expect(await screen.findByText('LDL cholesterol: 160 mg/dL')).toBeTruthy();
  });

  it('a red result sets the hold on saving, with today as the since date; the doctor button clears it', async () => {
    const db = await setup();
    expect(hold(db)).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    await fillRow(1, { name: 'HbA1c', value: '10', unit: '%', low: '4', high: '5.6' });
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    expect(await screen.findByText('Saved. One result needs a doctor’s review.')).toBeTruthy();
    expect(hold(db)).toEqual({ on: true, since: '2026-10-08' });
    expect(await screen.findByText(labs.hold_title)).toBeTruthy();
    expect(screen.getByText(labs.hold_body)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'I’ve seen my doctor' }));
    await waitFor(() => expect(hold(db)).toEqual({ on: false }));
    expect(await screen.findByText('Thanks. Normal targets are back.')).toBeTruthy();
    expect(screen.queryByText(labs.hold_title)).toBeNull();
  });

  it('a clean report does not start a hold, and does not clear one', async () => {
    const db = await setup(async (d) => saveHold(d, { on: true, since: '2026-09-01' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    await fillRow(1, { name: 'LDL cholesterol', value: '90', unit: 'mg/dL', low: '0', high: '100' });
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    await waitFor(() => expect(keys(db).length).toBe(2));
    expect(hold(db)).toEqual({ on: true, since: '2026-09-01' });
  });

  it('a blank value never starts a hold: it is rejected before saving', async () => {
    const db = await setup();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add a report' }));
    await fillRow(1, { name: 'Fasting glucose', unit: 'mg/dL' });
    await fireEvent.press(screen.getByRole('button', { name: 'Values are correct, save' }));
    expect(await screen.findByText('Enter the value as a number, like 5.4.')).toBeTruthy();
    expect(keys(db)).toEqual([]);
  });

  it('delete all reports needs a second tap, and leaves the hold on', async () => {
    const db = await setup(async (d) => {
      await saveReport(d, rep('r1', '2026-10-01', [test('Fasting glucose', '250', 'mg/dL', '70', '100')]));
      await saveHold(d, { on: true, since: '2026-10-01' });
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete all reports' }));
    expect(keys(db)).toContain('lab_store:lab|2026-10-01|r1');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Tap again to delete all reports' })));
    await waitFor(() => expect(keys(db)).toEqual(['lab_store:hold']));
    expect(screen.getByText(labs.hold_title)).toBeTruthy();
  });

  it('a failed read says it could not read the reports, not that a save failed', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const orig = db.getAllAsync.bind(db);
    db.getAllAsync = ((sql: string, ...p: (string | number)[]) => (sql.includes('lab_store') ? Promise.reject(new Error('disk')) : orig(sql, ...p))) as typeof db.getAllAsync;
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByText('Couldn’t read your lab reports. Try again.')).toBeTruthy();
    expect(screen.queryByText(/Couldn’t save the lab report/)).toBeNull();
  });
});

type TreeNode = { props?: Record<string, unknown>; children?: unknown[] | null };
/** True when the text is inside an element that groups its children into one accessible element: a screen reader then reads that element's own label only. */
function hiddenByGrouping(node: unknown, text: string, grouped = false): boolean | null {
  if (typeof node === 'string') return node.includes(text) ? grouped : null;
  if (!node || typeof node !== 'object') return null;
  const n = node as TreeNode;
  const g = grouped || n.props?.accessible === true;
  for (const c of n.children ?? []) {
    const r = hiddenByGrouping(c, text, g);
    if (r !== null) return r;
  }
  return null;
}

describe('results are read by a screen reader (the accessibility tree, not getByText)', () => {
  it('the red notice, tip, range, unit note and trend are not inside an accessible grouping', async () => {
    await setup(async (d) => {
      await saveReport(d, rep('r0', '2026-08-01', [test('Fasting glucose', '240', 'mg/dL', '70', '100'), test('LDL cholesterol', '160', 'mg/dL', '0', '100')]));
      await saveReport(d, rep('r1', '2026-10-01', [test('Fasting glucose', '250', 'mg/dL', '70', '100'), test('LDL cholesterol', '150', 'mg/dL', '0', '100'), test('Vitamin D', '10', 'bananas', '30', '100')]));
    });
    await screen.findByText('Fasting glucose: 250 mg/dL');
    const tree = screen.toJSON();
    for (const t of [labs.red_notice, labs.markers.ldl!.high!, 'Lab range 70 to 100, far outside', labs.unit_unrecognised, 'Trend: 1 Aug: 240, 1 Oct: 250']) expect([t, hiddenByGrouping(tree, t)]).toEqual([t, false]);
    await fireEvent.press(screen.getByRole('button', { name: 'All results (3)' }));
    expect(hiddenByGrouping(screen.toJSON(), 'Trend: 1 Aug: 160, 1 Oct: 150')).toBe(false);
  });
});
