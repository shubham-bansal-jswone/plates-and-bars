import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import labels from '../../../content/labels.json';
import { BackHandler } from 'react-native';
import { loadContent } from '../src/content/loader';
import { openDb } from './sync-helpers';
import { HowToSheet } from '../src/workout/parts';
import { LibraryEntryButton } from '../src/library/LibraryEntryButton';
import { filterLibrary, getEquipment, getLibrary, getMuscles, getTypes, NO_FILTER } from '../src/library/exercises';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
const openFilters = async () => fireEvent.press(screen.getByLabelText('Filters'));
const LIBRARY = getLibrary();
const EQUIPMENT = getEquipment();
const MUSCLES = getMuscles();
const TYPES = getTypes();

describe('library filtering', () => {
  it('lists every content exercise A to Z with no filter', () => {
    expect(LIBRARY.length).toBe(71);
    expect(filterLibrary(LIBRARY, NO_FILTER)).toHaveLength(71);
    expect(LIBRARY.map((e) => e.name)).toEqual([...LIBRARY.map((e) => e.name)].sort((a, b) => a.localeCompare(b)));
  });

  it('search matches every typed word in any case', () => {
    const r = filterLibrary(LIBRARY, { ...NO_FILTER, query: 'bench  BARBELL' });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => /bench/i.test(e.name) && /barbell/i.test(e.name))).toBe(true);
  });

  it('equipment, muscle and type narrow the list and combine', () => {
    const eq = filterLibrary(LIBRARY, { ...NO_FILTER, equipment: 'dumbbell' });
    expect(eq.length).toBeGreaterThan(0);
    expect(eq.every((e) => e.equipment === 'dumbbell')).toBe(true);
    const mu = filterLibrary(LIBRARY, { ...NO_FILTER, muscle: 'chest' });
    expect(mu.every((e) => e.primary.includes('chest'))).toBe(true);
    const both = filterLibrary(LIBRARY, { ...NO_FILTER, equipment: 'dumbbell', muscle: 'chest' });
    expect(both.length).toBeLessThan(Math.min(eq.length, mu.length) + 1);
    expect(both.every((e) => e.equipment === 'dumbbell' && e.primary.includes('chest'))).toBe(true);
    expect(filterLibrary(LIBRARY, { ...NO_FILTER, type: 'assisted' }).every((e) => e.type === 'assisted')).toBe(true);
  });

  it('every exercise uses a contract equipment, muscle and type value', () => {
    for (const e of LIBRARY) {
      expect(EQUIPMENT).toContain(e.equipment);
      expect(TYPES).toContain(e.type);
      for (const m of [...e.primary, ...e.secondary]) expect(Object.keys(labels.muscles)).toContain(m);
    }
  });
});

describe('exercise library screen', () => {
  it('shows the count, filters by chip and clears', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    expect(screen.getByText('71 of 71 exercises')).toBeTruthy();
    await openFilters();
    await fireEvent.press(screen.getAllByLabelText('Cable')[0]!);
    const n = filterLibrary(LIBRARY, { ...NO_FILTER, equipment: 'cable' }).length;
    expect(screen.getByText(`${n} of 71 exercises`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Clear filters'));
    expect(screen.getByText('71 of 71 exercises')).toBeTruthy();
  });

  it('shows an empty state when nothing matches', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzzz');
    expect(screen.getByText(/No exercises match/)).toBeTruthy();
    expect(screen.getByText('0 of 71 exercises')).toBeTruthy();
  });

  it('opens a detail with tags and notes, and goes back', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'barbell bench press');
    await fireEvent.press(screen.getByText('Barbell Bench Press'));
    expect(screen.getByText('Barbell Bench Press')).toBeTruthy();
    expect(screen.getByText('Equipment: ', { exact: false })).toBeTruthy();
    expect(screen.getByText('Where you should feel it')).toBeTruthy();
    expect(screen.getByText('Key cues')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back to library'));
    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
  });

  it('radios cannot be unticked; All resets the group', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    const n = filterLibrary(LIBRARY, { ...NO_FILTER, equipment: 'cable' }).length;
    await openFilters();
    await fireEvent.press(screen.getAllByLabelText('Cable')[0]!);
    await fireEvent.press(screen.getAllByLabelText('Cable')[0]!);
    expect(screen.getByText(`${n} of 71 exercises`)).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('All')[0]!);
    expect(screen.getByText('71 of 71 exercises')).toBeTruthy();
  });

  it('has no chip that can never match', () => {
    for (const eq of EQUIPMENT) expect(filterLibrary(LIBRARY, { ...NO_FILTER, equipment: eq }).length).toBeGreaterThan(0);
    for (const m of MUSCLES) expect(filterLibrary(LIBRARY, { ...NO_FILTER, muscle: m }).length).toBeGreaterThan(0);
    for (const t of TYPES) expect(filterLibrary(LIBRARY, { ...NO_FILTER, type: t }).length).toBeGreaterThan(0);
    expect(EQUIPMENT).not.toContain('other');
  });

  it('hardware back from a detail returns to the list', async () => {
    let handler: () => boolean = () => false;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handler = h as () => boolean;
      return { remove: () => undefined };
    });
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByText('Barbell Bench Press'));
    expect(screen.getByLabelText('Back to library')).toBeTruthy();
    await act(async () => { handler(); });
    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
  });

  it('collapses the filters, shows active ones as removable chips and keeps the count', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    expect(screen.queryByLabelText('Equipment filter')).toBeNull();
    await openFilters();
    expect(screen.getByLabelText('Equipment filter')).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('Cable')[0]!);
    await fireEvent.press(screen.getByLabelText('Hide filters'));
    expect(screen.queryByLabelText('Equipment filter')).toBeNull();
    const n = filterLibrary(LIBRARY, { ...NO_FILTER, equipment: 'cable' }).length;
    expect(screen.getByText(`${n} of 71 exercises`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Remove Cable filter'));
    expect(screen.getByText('71 of 71 exercises')).toBeTruthy();
  });

  it('rows carry a drawing thumbnail, or a placeholder with the first main muscle when none', async () => {
    await loadContent(await openDb());
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    expect(screen.getAllByTestId('figure-thumb', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'archer');
    expect(screen.queryAllByTestId('figure-thumb', { includeHiddenElements: true })).toHaveLength(0);
    expect(screen.getByText('Archer Push-ups')).toBeTruthy();
    expect(screen.getAllByText('Chest', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });

  it('the detail shows the drawing pair and the muscle map', async () => {
    await loadContent(await openDb());
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByText('Barbell Bench Press'));
    expect(screen.getByTestId('figure-row')).toBeTruthy();
    expect(screen.getByLabelText(/^Muscles worked: /)).toBeTruthy();
  });

  it('the detail numbers Setup, bullets cues, and shows a placeholder when there is no drawing', async () => {
    await loadContent(await openDb());
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByText('Barbell Bench Press'));
    expect(screen.queryByTestId('no-drawing')).toBeNull();
    expect(screen.getAllByText(/^1\. /).length).toBe(1);
    expect(screen.getAllByText(/^\u2022 /).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText('Back to library'));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'archer');
    await fireEvent.press(screen.getByText('Archer Push-ups'));
    expect(screen.getByTestId('no-drawing')).toBeTruthy();
    expect(screen.getByText('No drawing for this exercise yet')).toBeTruthy();
  });

  it('LibraryEntryButton closes the caller then opens the library route', async () => {
    const before = jest.fn();
    await render(<LibraryEntryButton onBeforeOpen={before} />);
    await fireEvent.press(screen.getByLabelText('Exercise library'));
    expect(before).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/library');
  });

  it('the how-to sheet shows the drawing above the muscle map', async () => {
    await loadContent(await openDb());
    await render(<HowToSheet name="Barbell Bench Press" onClose={() => {}} />);
    expect(screen.getByTestId('figure-row')).toBeTruthy();
    expect(screen.getByLabelText(/^Muscles worked: /)).toBeTruthy();
  });
});
