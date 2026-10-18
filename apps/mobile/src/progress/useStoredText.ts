import { useState } from 'react';

/**
 * Text for a box that shows a stored value. When the stored value changes (a pulled record, a phone step reading, a save from
 * the other screen) the box follows it, unless the user has typed something different meanwhile: then their text stays (#300).
 * Callers key the component by the day, so another day always starts from its own stored value.
 */
export function useStoredText(stored: string): [string, (text: string) => void] {
  const [text, setText] = useState(stored);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    if (text === seen) setText(stored);
  }
  return [text, setText];
}
