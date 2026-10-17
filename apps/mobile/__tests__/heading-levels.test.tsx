import { render, screen } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { H1, Heading } from '../src/components/ui';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';
import { sourcesMatching } from './source-files';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Node = { props?: Record<string, unknown>; children?: unknown[] };
/** `[aria-level, role]` of every heading host element, in document order. react-native-web turns `role="heading"` plus `aria-level` into the heading level. */
function headings(node: unknown, out: { level: unknown; role: unknown }[] = []) {
  if (!node || typeof node !== 'object') return out;
  const n = node as Node;
  if (n.props?.role === 'heading' || n.props?.accessibilityRole === 'header') out.push({ level: n.props['aria-level'], role: n.props.role ?? n.props.accessibilityRole });
  for (const c of n.children ?? []) headings(c, out);
  return out;
}
const levels = () => headings(screen.toJSON()).map((h) => h.level);

/** One level-one heading, a level on every heading, and no level more than one deeper than the one before. */
function expectOutline(l: unknown[]) {
  expect(l.filter((x) => x === 1)).toHaveLength(1);
  expect(l[0]).toBe(1);
  l.forEach((x, i) => {
    expect(typeof x).toBe('number');
    if (i > 0) expect(x as number).toBeLessThanOrEqual((l[i - 1] as number) + 1);
  });
}

describe('heading components', () => {
  it('H1 is level 1 and Heading hands the level it is given', async () => {
    await render(
      <>
        <H1>Title</H1>
        <Heading level={2}>Section</Heading>
        <Heading level={3}>Part</Heading>
      </>,
    );
    expect(levels()).toEqual([1, 2, 3]);
  });

  it('H1 can be told it is a second title-sized heading', async () => {
    await render(<H1 level={2}>Second</H1>);
    expect(levels()).toEqual([2]);
  });
});

describe('screen outlines', () => {
  it('Progress has one level-one heading and no skipped levels', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Progress' });
    expectOutline(levels());
  });

  it('Targets has one level-one heading: Your setup, which states the burn once', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <TargetsScreen db={db} />));
    await screen.findByRole('header', { name: 'Your setup' });
    expectOutline(levels());
  });

  it('Food has one level-one heading, with the meals at level 2', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Food' });
    expectOutline(levels());
    const meals = screen.getAllByRole('header', { name: /^(Breakfast|Lunch|Dinner|Snacks?)$/ });
    expect(meals.length).toBeGreaterThan(0);
    meals.forEach((m) => expect(m.props['aria-level']).toBe(2));
  });
});

describe('no heading without a level', () => {
  it('only Heading sets accessibilityRole="header" or role="heading", as a prop or in a spread object', () => {
    const bad = sourcesMatching(/(accessibilityRole|role)\s*[=:]\s*\{?\s*["'`](header|heading)["'`]/);
    expect(bad).toEqual([]);
  });
});
