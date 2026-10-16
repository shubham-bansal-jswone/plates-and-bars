import { useEffect, useRef, useState } from 'react';
import { Field } from '../components/ui';
import { parseCardio } from './cardio';

const show = (v: number | null) => (v == null ? '' : String(v));

/** Cardio minutes input. It keeps what was typed (so "1." and "1,5" survive the keystroke) and saves the parsed whole number;
 * it follows the saved value only when that changes from elsewhere (a sync pull, a reload), and tidies the text on blur. */
export function CardioField({ value, onSave }: { value: number | null; onSave: (text: string) => void }) {
  const [text, setText] = useState(show(value));
  const saved = useRef(value);
  useEffect(() => {
    if (value !== saved.current) {
      saved.current = value;
      setText(show(value));
    }
  }, [value]);
  return (
    <Field
      label="Cardio minutes"
      keyboardType="number-pad"
      maxLength={4}
      placeholder="0"
      value={text}
      onChangeText={(t) => {
        setText(t);
        saved.current = parseCardio(t);
        onSave(t);
      }}
      onBlur={() => setText(show(saved.current))}
    />
  );
}
