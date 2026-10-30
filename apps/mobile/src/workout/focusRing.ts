/** A visible focus ring on a script-focused web element (the browser draws none after a click, :focus-visible), removed again when it loses focus. */
export function ringUntilBlur(el: Pick<HTMLElement, 'style' | 'addEventListener'>, colour: string): void {
  el.style.outline = `2px solid ${colour}`;
  el.style.outlineOffset = '2px';
  el.addEventListener('blur', () => (el.style.outline = ''), { once: true });
}
