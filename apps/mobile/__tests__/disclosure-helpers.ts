import { fireEvent, screen } from '@testing-library/react-native';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowOf = (name: string) => screen.queryByRole('button', { name: new RegExp(`^${esc(name)}, \\d+/\\d+ sets\\. Show sets`) });

/**
 * `fireEvent.press` on the control named `label`, exactly as it is on screen. It never opens anything on the way, so a control that
 * moved behind a closed disclosure or a collapsed exercise fails here: open that one explicitly with `expand`, `reveal` or `open`.
 */
export function press(label: string | RegExp) {
  return fireEvent.press(screen.getByLabelText(label));
}

/** Opens the one disclosure named `label` when it is closed. */
export async function open(label: string | RegExp) {
  const d = screen.getByRole('button', { name: label });
  if (d.props.accessibilityState?.expanded === false) await fireEvent.press(d);
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

/** Presses a workout chip ("Choose …", "Pick exercises") on the start view, opening "Choose another day" first when that disclosure is there and closed. */
export async function pressDay(label: string) {
  const d = screen.queryByRole('button', { name: 'Choose another day' });
  if (d?.props.accessibilityState?.expanded === false) await fireEvent.press(d);
  return press(label);
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
