import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as useThemeModule from '../src/theme/useTheme';
import { Button } from '../src/components/ui';
import { dark, light, linkText } from '../src/theme/tokens';
import { FoodScreen } from '../src/screens/FoodScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { HowToSheet } from '../src/workout/parts';
import { getLibrary } from '../src/library/exercises';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

// #1271: the accent (`brand`) is the key number and the one primary action. Everything else a user can press is neutral.
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

const COLOUR_KEYS = ['color', 'backgroundColor', 'borderColor'] as const;
type Node = ReturnType<typeof screen.getAllByRole>[number];
const subtree = (n: Node): Node[] => [n, ...n.children.flatMap((c) => (typeof c === 'string' ? [] : subtree(c as Node)))];
/** Labels of pressable controls (buttons, links) drawn in the accent: its colour on the control or anything inside it. Selected or checked controls are state, not actions. */
function accentActions(accents: string[]): string[] {
  const out: string[] = [];
  for (const role of ['button', 'link'] as const) {
    for (const el of screen.queryAllByRole(role, { hidden: true }) as Node[]) {
      const state = el.props.accessibilityState ?? {};
      if (state.selected || state.checked) continue;
      const hit = subtree(el).some((n) => {
        const s = StyleSheet.flatten(n.props.style) as Record<string, unknown> | undefined;
        return !!s && COLOUR_KEYS.some((k) => accents.includes(String(s[k]).toUpperCase()));
      });
      if (hit) out.push(String(el.props.accessibilityLabel ?? el.props['aria-label'] ?? ''));
    }
  }
  return out;
}

afterEach(() => jest.restoreAllMocks());

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_m, p) => {
  // Every accent shade: the old light `link` was brandPressed, not brand.
  const accent = [p.brand, p.brandPressed, p.brandActive].map((x) => x.toUpperCase());
  beforeEach(() => jest.spyOn(useThemeModule, 'useTheme').mockReturnValue(p));

  it('the shared link kind is the neutral ink, underlined; ghost is neutral too; only primary is the accent', async () => {
    await render(<><Button label="L" kind="link" onPress={() => {}} /><Button label="G" kind="ghost" onPress={() => {}} /><Button label="P" onPress={() => {}} /></>);
    const text = (l: string) => StyleSheet.flatten(screen.getByText(l).props.style);
    expect(text('L')).toMatchObject({ color: p.ink, ...linkText });
    expect(text('G').color).toBe(p.ink);
    expect(accentActions(accent)).toEqual(['P']);
  });

  it('Food: no accent action (the key number is text, not an action)', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Food' });
    expect(screen.getByLabelText('+ Add to breakfast')).toBeTruthy();
    expect(screen.getAllByText('Recipes').length).toBeGreaterThan(0);
    expect(accentActions(accent)).toEqual([]);
  });

  it('Workout session: at most one accent action', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Why these exercises?');
    expect(screen.getAllByText('Start the ramp').length).toBeGreaterThan(0);
    expect(accentActions(accent).length).toBeLessThanOrEqual(1);
  });

  it('Progress: at most one accent action, and "Use a 4-day plan next week" is not it', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Progress' });
    expect(accentActions(accent).length).toBeLessThanOrEqual(1);
  });

  it('Targets: at most one accent action', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <TargetsScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Your setup' });
    expect(accentActions(accent).length).toBeLessThanOrEqual(1);
  });

  it('Library detail: Back to library and the drawing credit are neutral', async () => {
    const e = getLibrary().find((x) => x.card)!;
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByText(e.name));
    expect(screen.getByLabelText('Back to library')).toBeTruthy();
    expect(accentActions(accent)).toEqual([]);
  });

  it('How-to sheet: the drawing credit is neutral', async () => {
    await render(<HowToSheet name="Barbell Bench Press" onClose={() => {}} />);
    // The sheet's own Close is its one primary action; the credit under the drawing must not add a second.
    expect(accentActions(accent).filter((l) => l !== 'Close')).toEqual([]);
  });
});

