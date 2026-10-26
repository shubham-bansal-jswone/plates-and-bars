import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { exInfo, type Suggestion } from '@plate-and-bar/core';
import { Disclosure, MetricRow } from '../src/components/ui';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe('Disclosure', () => {
  it('is closed by default, exposes expanded, and mounts its children only when open', async () => {
    await render(<Disclosure label="Guide"><Text>inside</Text></Disclosure>);
    const row = screen.getByRole('button', { name: 'Guide' });
    expect(row.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByText('inside')).toBeNull();
    await fireEvent.press(row);
    expect(screen.getByRole('button', { name: 'Guide' }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText('inside')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Guide' }));
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('opens at once with defaultOpen, and the row is at least 56 high', async () => {
    await render(<Disclosure label="Guide" defaultOpen><Text>inside</Text></Disclosure>);
    const row = screen.getByRole('button', { name: 'Guide' });
    expect(row.props.accessibilityState).toMatchObject({ expanded: true });
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(screen.getByText('inside')).toBeTruthy();
  });
});

describe('MetricRow', () => {
  it('names each cell "label: value" and puts a divider before every cell but the first', async () => {
    await render(<MetricRow cells={[{ label: 'Exercises', value: '6' }, { label: 'Sets', value: '18' }]} />);
    const a = screen.getByLabelText('Exercises: 6');
    const b = screen.getByLabelText('Sets: 18');
    expect(StyleSheet.flatten(a.props.style).borderLeftWidth).toBeUndefined();
    expect(StyleSheet.flatten(b.props.style).borderLeftWidth).toBe(1);
  });
});

const NAME = 'Barbell Bench Press';
const SUG: Suggestion = { mode: 'hold', reps: 8, w: 40, text: '40 kg × 8 reps', reason: 'Same again.' };
const act = new Proxy({}, { get: () => jest.fn() }) as Actions;
function card(o: { prior?: number; done?: number; expanded?: boolean; onToggle?: () => void } = {}) {
  const sets = Array.from({ length: 3 }, (_, j) => ({ ...blankRow(), w: '40', r: '8', done: j < (o.done ?? 0) }));
  const ex: ExState = { name: NAME, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets };
  return render(<ExerciseCard ex={ex} info={exInfo(NAME, getCatalog())} sug={SUG} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} prior={o.prior} {...(o.expanded === undefined ? {} : { expanded: o.expanded })} {...(o.onToggle ? { onToggle: o.onToggle } : {})} />);
}
const guide = () => screen.getByRole('button', { name: `Guide and tools for ${NAME}` });

describe('ExerciseCard guide and collapse', () => {
  it('opens the guide by default on the very first session of an exercise', async () => {
    await card({ prior: 0 });
    expect(guide().props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByLabelText(`How to do ${NAME}`)).toBeTruthy();
  });

  it('keeps the guide closed after earlier sessions, with the sets and the suggestion still showing', async () => {
    await card({ prior: 2 });
    expect(guide().props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByLabelText(`How to do ${NAME}`)).toBeNull();
    expect(screen.getByText('Suggested: 40 kg × 8 reps')).toBeTruthy();
    expect(screen.getByLabelText(`${NAME} set 1 kg`)).toBeTruthy();
  });

  it('makes the tick 56 and the inputs 56 high', async () => {
    await card({ prior: 2 });
    const tick = StyleSheet.flatten(screen.getByLabelText(`Mark ${NAME} set 1 done`).props.style);
    expect(tick).toMatchObject({ width: 56, height: 56 });
    expect(StyleSheet.flatten(screen.getByLabelText(`${NAME} set 1 kg`).props.style).height).toBe(56);
  });

  it('collapsed: one row with the progress, no inputs, and a tap asks the screen to expand it', async () => {
    const onToggle = jest.fn();
    await card({ expanded: false, done: 2, onToggle });
    expect(screen.queryByLabelText(`${NAME} set 1 kg`)).toBeNull();
    expect(screen.getByText('2/3 sets')).toBeTruthy();
    const row = screen.getByRole('button', { name: `${NAME}, 2/3 sets. Show sets` });
    expect(row.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(row);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
