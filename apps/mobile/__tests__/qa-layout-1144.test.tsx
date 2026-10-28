import { Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { getEquipment, getLibrary, getMuscles } from '../src/library/exercises';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { setCustomTags } from '../src/workout/catalog';
import { HowToSheet } from '../src/workout/parts';
import { AddExerciseSheet } from '../src/workout/AddExerciseSheet';
import { CustomTagsSheet } from '../src/workout/CustomTagsSheet';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { COLUMN_MAX } from '../src/components/ui';
import { space, type } from '../src/theme/tokens';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: () => {},
}));

const tag = { pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: ['chest'], secondary: [], joints: [] };
const style = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style as object) ?? {}) as Record<string, number | string | undefined>;

afterEach(() => {
  setCustomTags({});
  jest.restoreAllMocks();
});

describe('#1144 library Filters', () => {
  it('sits in the same wrapping row as the search field, which flexes', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    const search = screen.getByLabelText('Search exercises');
    type J = { props?: { style?: unknown; accessibilityLabel?: string; 'aria-label'?: string }; children?: J[] | null };
    const has = (n: J, label: string): boolean => n.props?.accessibilityLabel === label || n.props?.['aria-label'] === label || (n.children ?? []).some((k) => typeof k === 'object' && has(k, label));
    const rows: J[] = [];
    const walk = (n: J) => {
      if (has(n, 'Search exercises') && has(n, 'Filters')) rows.push(n);
      (n.children ?? []).forEach((k) => typeof k === 'object' && walk(k));
    };
    walk(screen.toJSON() as unknown as J);
    const row = rows[rows.length - 1]!; // the innermost node holding both
    expect(StyleSheet.flatten(row.props?.style as object)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(Number(style(search).flexGrow)).toBeGreaterThanOrEqual(1);
    expect(Number(style(search).minWidth)).toBeGreaterThan(200); // a phone column cannot hold it beside Filters, so Filters wraps
  });
});

describe('#1144 library list follows custom exercises', () => {
  it('getLibrary and the chip lists rebuild when a custom exercise is added or removed', () => {
    const before = getLibrary().length;
    setCustomTags({ 'QA Lift': tag });
    expect(getLibrary()).toHaveLength(before + 1);
    expect(getLibrary().some((e) => e.name === 'QA Lift')).toBe(true);
    expect(getEquipment()).toContain('machine');
    expect(getMuscles()).toContain('chest');
    setCustomTags({});
    expect(getLibrary()).toHaveLength(before);
  });

  it('an open Library shows the new exercise and the right count without reopening', async () => {
    const db = memoryDb();
    let add: ((name: string) => Promise<boolean>) | undefined;
    const Grab = () => {
      const s = useSettings();
      add = (name) => s.addCustomTags(name, tag);
      return null;
    };
    const n = getLibrary().length;
    await render(
      <SettingsProvider db={db}>
        <Grab />
        <ExerciseLibraryScreen onBack={() => {}} />
      </SettingsProvider>,
    );
    await screen.findByText(`${n} of ${n} exercises`);
    await act(async () => void (await add!('QA Lift')));
    await screen.findByText(`${n + 1} of ${n + 1} exercises`);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'QA');
    expect(screen.getByText('QA Lift')).toBeTruthy();
  });
});

describe('#1144 how-to sheet order', () => {
  it('puts the title before the close X, so X is the next stop after the title', async () => {
    const name = getLibrary().find((e) => e.card)!.name;
    await render(<HowToSheet name={name} onClose={() => {}} />);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf(JSON.stringify(name))).toBeGreaterThan(-1);
    expect(tree.indexOf(`"Close ${name} guide"`)).toBeGreaterThan(tree.indexOf(JSON.stringify(name)));
  });
});

describe('#1144 add exercise sheet', () => {
  it('is held to the shared column width and uses the shared heading style', async () => {
    await render(<AddExerciseSheet inSession={[]} onClose={() => {}} onPick={() => {}} onCustom={() => {}} />);
    const h = screen.getByRole('header', { name: 'Add exercise' });
    expect(style(h)).toMatchObject({ fontSize: type.heading.fontSize, fontWeight: type.heading.fontWeight });
    let n = h.parent;
    while (n && style(n).maxWidth !== COLUMN_MAX) n = n.parent;
    expect(n).toBeTruthy();
  });
});

describe('#1144 custom exercise sheet', () => {
  it('is held to the shared column width', async () => {
    await render(<CustomTagsSheet name="Zercher carry" onSave={() => {}} onClose={() => {}} />);
    const h = screen.getByRole('header', { name: 'Zercher carry' });
    let n = h.parent;
    while (n && !n.props.contentContainerStyle) n = n.parent;
    const content = StyleSheet.flatten(n!.props.contentContainerStyle) as { maxWidth: number; padding: number };
    expect(content.maxWidth - 2 * content.padding).toBe(COLUMN_MAX);
  });
});

describe('#1144 Targets columns', () => {
  it('the first heading of the right column starts at the same top as the H1 at wide widths', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
    const db = memoryDb();
    await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 9, 8)));
    await render(withProfile(db, <TargetsScreen db={db} />));
    const h1 = await screen.findByRole('header', { name: 'Your setup' });
    const rules = screen.getByRole('header', { name: 'Training rules' });
    expect(style(rules).marginTop).toBe(style(h1).marginTop);
    expect(style(rules).marginTop).toBe(space.sm);
  });
});
