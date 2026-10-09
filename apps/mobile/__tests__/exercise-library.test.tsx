import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import labels from '../../../content/labels.json';
import { BackHandler } from 'react-native';
import { EQUIPMENT, filterLibrary, LIBRARY, MUSCLES, NO_FILTER, TYPES } from '../src/library/exercises';

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
    await fireEvent.press(screen.getByLabelText(/^Barbell Bench Press\./));
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
    await fireEvent.press(screen.getByLabelText(/^Barbell Bench Press\./));
    expect(screen.getByLabelText('Back to library')).toBeTruthy();
    await act(async () => { handler(); });
    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
  });

  it('shows no images', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });
});
