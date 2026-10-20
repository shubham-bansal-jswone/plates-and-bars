import { prototypeSource } from './helpers';

export interface ProtoLabs {
  markerOf(name: string): { key: string } | null;
  labFlag(t: { name: string; value: string; low: string; high: string }): string;
}

/** The prototype's own `markerOf`, `RED` and `labFlag`, cut from the HTML (from `const MARKERS` to `const LAB`) and run with its `num`. */
export function loadLabs(): ProtoLabs {
  const lines = prototypeSource().split('\n');
  const from = lines.findIndex((l) => l.startsWith('const MARKERS = ['));
  const to = lines.findIndex((l) => l.startsWith('const LAB = {'));
  const numLine = lines.find((l) => l.startsWith('const num = '));
  if (from < 0 || to < from || !numLine) throw new Error('prototype: lab report block not found');
  return new Function(`${numLine}\n${lines.slice(from, to).join('\n')}\nreturn { markerOf, labFlag };`)() as ProtoLabs;
}
