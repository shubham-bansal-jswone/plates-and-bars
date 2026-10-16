import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CardioField } from '../src/workout/CardioField';
import { parseCardio } from '../src/workout/cardio';

/** The field as the screen uses it: the parent saves the parsed number and passes it back as `value`. */
function Host({ initial, onSaved }: { initial: number | null; onSaved?: (v: number | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <CardioField
      value={v}
      onSave={(t) => {
        const n = parseCardio(t);
        setV(n);
        onSaved?.(n);
      }}
    />
  );
}

const field = () => screen.getByLabelText('Cardio minutes');
const typeKeys = async (keys: string) => {
  for (const k of keys) await fireEvent.changeText(field(), `${field().props.value}${k}`);
};

describe('CardioField', () => {
  it('keeps the text as typed while the parsed number is saved', async () => {
    const saved: (number | null)[] = [];
    await render(<Host initial={null} onSaved={(v) => saved.push(v)} />);
    await typeKeys('1.5');
    expect(field().props.value).toBe('1.5');
    expect(saved).toEqual([1, 1, 2]);
  });

  it('a comma decimal typed key by key saves 2, not 15', async () => {
    const saved: (number | null)[] = [];
    await render(<Host initial={null} onSaved={(v) => saved.push(v)} />);
    await typeKeys('1,5');
    expect(field().props.value).toBe('1,5');
    expect(saved.at(-1)).toBe(2);
  });

  it('a minus sign typed first is not turned into 0 or dropped', async () => {
    const saved: (number | null)[] = [];
    await render(<Host initial={null} onSaved={(v) => saved.push(v)} />);
    await typeKeys('-5');
    expect(field().props.value).toBe('-5');
    expect(saved.at(-1)).toBe(0);
  });

  it('on blur the text shows the saved whole number', async () => {
    await render(<Host initial={null} />);
    await typeKeys('1.5');
    await fireEvent(field(), 'blur');
    expect(field().props.value).toBe('2');
  });

  it('follows the saved value when it changes from elsewhere, and clears when it becomes empty', async () => {
    const view = await render(<CardioField value={10} onSave={() => {}} />);
    expect(field().props.value).toBe('10');
    await view.rerender(<CardioField value={20} onSave={() => {}} />);
    expect(field().props.value).toBe('20');
    await view.rerender(<CardioField value={null} onSave={() => {}} />);
    expect(field().props.value).toBe('');
  });
});
