import { getCatalog } from './catalog';

/**
 * Prototype `musclesOf`: the main muscles of a list of exercises, and the also-working ones that are not already main.
 * Reads each exercise's `primary` and `secondary` from the exercise content; an exercise the content does not know adds nothing.
 */
export function musclesOf(names: readonly string[]): { primary: string[]; secondary: string[] } {
  const { tags } = getCatalog();
  const primary = [...new Set(names.flatMap((n) => tags[n]?.primary ?? []))];
  const secondary = [...new Set(names.flatMap((n) => tags[n]?.secondary ?? []))].filter((m) => !primary.includes(m));
  return { primary, secondary };
}
