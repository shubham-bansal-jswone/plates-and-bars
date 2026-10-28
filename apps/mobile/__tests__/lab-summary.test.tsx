import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { saveReport } from '../src/db/labs';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { labs } from '../src/labs/content';
import { buildLabSummary } from '../src/labs/summary';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
const mockSave = jest.fn();
const mockClear = jest.fn();
jest.mock('../src/account/saveFile', () => ({ saveTextFile: (...a: unknown[]) => mockSave(...a), clearOldExports: (...a: unknown[]) => mockClear(...a) }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const realFlag = process.env.EXPO_PUBLIC_LAB_REPORTS;
beforeEach(() => {
  process.env.EXPO_PUBLIC_LAB_REPORTS = '1';
  mockSave.mockReset().mockResolvedValue('shared');
  mockClear.mockReset();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_LAB_REPORTS;
  else process.env.EXPO_PUBLIC_LAB_REPORTS = realFlag;
});

const profile = () => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '82', activity: 'sitting', where: 'gym', days: 4, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const t = (name: string, value: string, unit: string, low = '', high = '') => ({ name, value, unit, low, high });
const reports = [
  { id: 'a', date: '2026-09-01', tests: [t('LDL cholesterol', '120', 'mg/dL', '0', '100'), t('Vitamin D', '30', 'ng/mL', '20', '50')] },
  { id: 'b', date: '2026-10-01', tests: [t('Mystery', '5', 'u')] },
];

async function setup(rows: typeof reports) {
  const db = memoryDb();
  await saveProfile(db, profile());
  for (const r of rows) await saveReport(db, r);
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  await screen.findByRole('header', { name: 'Lab reports' });
}

describe('Summary for my doctor button', () => {
  it('is absent with no reports', async () => {
    await setup([]);
    expect(screen.queryByRole('button', { name: 'Summary for my doctor' })).toBeNull();
  });
  it('is present once a report is saved', async () => {
    await setup(reports);
    expect(await screen.findByRole('button', { name: 'Summary for my doctor' })).toBeTruthy();
  });
  it('Delete all reports removes the shared file with no age limit and clears the note', async () => {
    await setup(reports);
    await fireEvent.press(await screen.findByRole('button', { name: 'Summary for my doctor' }));
    expect(await screen.findByText(/ready to share/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete all reports' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tap again to delete all reports' }));
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledWith();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Summary for my doctor' })).toBeNull());
    expect(screen.queryByText(/ready to share/)).toBeNull();
  });
  it('shares the plain text through the export save path', async () => {
    await setup(reports);
    await fireEvent.press(await screen.findByRole('button', { name: 'Summary for my doctor' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    const [name, mime, text] = mockSave.mock.calls[0] as [string, string, string];
    expect(name).toMatch(/\.txt$/);
    expect(mime).toBe('text/plain');
    expect(text).toBe(buildLabSummary(reports));
    expect(await screen.findByText(/ready to share/)).toBeTruthy();
  });
  it('says so when sharing is unavailable or throws, without the text', async () => {
    await setup(reports);
    mockSave.mockResolvedValueOnce('unavailable');
    await fireEvent.press(await screen.findByRole('button', { name: 'Summary for my doctor' }));
    expect(await screen.findByText('Sharing is not available on this device.')).toBeTruthy();
    mockSave.mockRejectedValueOnce(new Error('LDL 190'));
    await fireEvent.press(screen.getByRole('button', { name: 'Summary for my doctor' }));
    expect(await screen.findByText(/Couldn’t make the summary/)).toBeTruthy();
    expect(screen.queryByText(/LDL 190/)).toBeNull();
  });
});

describe('buildLabSummary', () => {
  it('lists each report with values, units, ranges and flag words, then the disclaimer, and nothing else', () => {
    const text = buildLabSummary(reports) as string;
    expect(text).toBe(
      [
        'Summary for my doctor',
        'Report date: 2026-09-01\n- LDL cholesterol: 120 mg/dL (lab range 0 to 100) - High\n- Vitamin D: 30 ng/mL (lab range 20 to 50) - Within the lab’s range',
        'Report date: 2026-10-01\n- Mystery: 5 u (no range entered)',
        labs.not_medical_advice,
      ].join('\n\n') + '\n',
    );
    expect(text).not.toMatch(/82|175|kg|calorie|\bid\b/i);
  });
  it('says when a unit is not recognised and adds no flag word when there is nothing to flag', () => {
    const text = buildLabSummary([{ id: 'x', date: '2026-10-01', tests: [t('LDL cholesterol', '120', 'zzz', '0', '100'), t('Vitamin D', 'abc', 'ng/mL', '20', '50')] }]) as string;
    expect(text).toContain('- LDL cholesterol: 120 zzz (lab range 0 to 100; unit not recognised)');
    expect(text).toContain('- Vitamin D: abc ng/mL (lab range 20 to 50)\n');
    expect(text).not.toContain('No range printed');
  });
  it('marks a result far outside the range as needing a doctor, never diagnoses', () => {
    const text = buildLabSummary([{ id: 'x', date: '2026-10-01', tests: [t('LDL cholesterol', '400', 'mg/dL', '0', '100')] }]) as string;
    expect(text).toContain('Needs a doctor’s review');
    expect(text).not.toMatch(/diagnos(is|ed) with|you have/i);
  });
  it('is null for no reports and skips damaged ones', () => {
    expect(buildLabSummary([])).toBeNull();
    expect(buildLabSummary([{ id: 'x', date: '2026-10-01', tests: [] }])).toBeNull();
    const damaged = [{ id: 'y', date: 5, tests: [null, { name: 3 }] }] as unknown as typeof reports;
    const text = buildLabSummary(damaged) as string;
    expect(text).toContain('Report date: not entered');
    expect(text).toContain('Unnamed test: no value (no range entered)');
    expect(buildLabSummary([{ id: 'z' } as never, null as never])).toBeNull();
  });
});

describe('web download', () => {
  it('downloads a .txt through the real save path', async () => {
    const real = jest.requireActual('../src/account/saveFile') as typeof import('../src/account/saveFile');
    const original = Platform.OS;
    Platform.OS = 'web';
    const click = jest.fn();
    const created = { click, remove: jest.fn(), href: '', download: '' } as unknown as HTMLAnchorElement;
    const g = globalThis as unknown as { document?: unknown; URL: typeof URL; Blob?: unknown };
    const prev = { document: g.document, create: URL.createObjectURL };
    g.document = { createElement: () => created, body: { appendChild: jest.fn() } };
    URL.createObjectURL = jest.fn(() => 'blob:x');
    try {
      expect(await real.saveTextFile('plate-and-bar-lab-summary.txt', 'text/plain', 'hi')).toBe('saved');
      expect(created.download).toBe('plate-and-bar-lab-summary.txt');
      expect(click).toHaveBeenCalled();
    } finally {
      Platform.OS = original;
      g.document = prev.document;
      URL.createObjectURL = prev.create;
    }
  });
});
