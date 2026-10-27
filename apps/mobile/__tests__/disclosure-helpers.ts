import { fireEvent, screen } from '@testing-library/react-native';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowOf = (name: string) => screen.queryByRole('button', { name: new RegExp(`^${esc(name)}, \\d+/\\d+ sets\\. Show sets`) });

/**
 * `fireEvent.press` on the control named `label`, opening what hides it first: the workout screen keeps day choices, the
 * check-in, week tools and each exercise's guide in disclosures, and only one exercise's sets expanded at a time.
 */
export async function press(label: string | RegExp) {
  if (!screen.queryByLabelText(label)) {
    // The collapsed exercise the label names (the longest name inside it), then every closed disclosure.
    const text = typeof label === 'string' ? label : '';
    const rows = screen.queryAllByRole('button', { name: / sets\. Show sets$/ }).filter((r) => text.includes(String(r.props.accessibilityLabel).split(', ')[0]!));
    const row = rows.sort((x, y) => String(y.props.accessibilityLabel).length - String(x.props.accessibilityLabel).length)[0];
    if (row) await fireEvent.press(row);
    for (const b of screen.queryAllByRole('button')) if (b.props.accessibilityState?.expanded === false && !/Show sets$/.test(String(b.props.accessibilityLabel))) await fireEvent.press(b);
  }
  return fireEvent.press(screen.getByLabelText(label));
}

/** Opens an exercise's sets when it is collapsed (one exercise is expanded at a time). */
export async function expand(name: string) {
  const row = rowOf(name);
  if (row) await fireEvent.press(row);
}

/** Expands an exercise and opens its "Guide and tools", so its cards and links are on screen. */
export async function reveal(name: string) {
  await expand(name);
  const g = screen.queryByLabelText(`Guide and tools for ${name}`);
  if (g && !g.props.accessibilityState?.expanded) await fireEvent.press(g);
}

/** Types 10 and 10 into set 1 of every exercise and ticks it, expanding each exercise in turn. Returns how many exercises. */
export async function tickFirstSets(): Promise<number> {
  let count = 0;
  for (;;) {
    for (const m of screen.queryAllByLabelText(/^Mark .* set 1 done$/)) {
      const n = /^Mark (.*) set 1 done$/.exec(m.props.accessibilityLabel as string)![1];
      const wt = screen.queryByLabelText(`${n} set 1 kg`) ?? screen.queryByLabelText(`${n} set 1 kg each`);
      if (wt) await fireEvent.changeText(wt, '10');
      await fireEvent.changeText(screen.getByLabelText(`${n} set 1 reps`), '10');
      await fireEvent.press(m);
      count++;
    }
    const next = screen.queryAllByRole('button', { name: /, 0\/\d+ sets\. Show sets$/ })[0];
    if (!next) return count;
    await fireEvent.press(next);
  }
}
