/** The DOM members the radio group pattern needs; a real element has them all. */
export interface RadioEl {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  focus(): void;
  click(): void;
}
export interface GroupEl {
  querySelectorAll(selector: string): ArrayLike<RadioEl>;
}

const RADIOS = '[role="radio"]:not([aria-disabled="true"])';
const radiosOf = (group: GroupEl): RadioEl[] => Array.from(group.querySelectorAll(RADIOS));

/**
 * The radio group pattern's one tab stop (#1409): the checked radio is tabbable and the others are not; with none checked the first is.
 * Run after the group renders. A group on a page with no radios, or one the DOM does not answer, is left alone.
 */
export function syncTabStops(group: GroupEl | null): void {
  if (!group || typeof group.querySelectorAll !== 'function') return;
  const radios = radiosOf(group);
  const checked = radios.findIndex((r) => r.getAttribute('aria-checked') === 'true');
  const stop = checked >= 0 ? checked : 0;
  radios.forEach((r, i) => r.setAttribute('tabindex', i === stop ? '0' : '-1'));
}

/**
 * Arrow keys move the selection (#1409): Right or Down to the next radio, Left or Up to the previous, wrapping at the ends. The next radio
 * is focused and clicked, which selects it as a tap would. Returns whether the key was handled (the caller then stops the page scrolling).
 */
export function arrowSelect(group: GroupEl | null, target: unknown, key: string, ctrlAltMeta = false): boolean {
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (!group || typeof group.querySelectorAll !== 'function' || !step || ctrlAltMeta) return false;
  const radios = radiosOf(group);
  const at = radios.findIndex((r) => r === target);
  if (at < 0 || radios.length < 2) return false;
  const next = radios[(at + step + radios.length) % radios.length];
  if (!next) return false;
  next.focus();
  next.click();
  return true;
}
