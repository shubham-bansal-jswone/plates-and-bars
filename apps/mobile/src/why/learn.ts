/** `Settings.learn` is an open object in the contract; the app keeps `{ start, read }` in it, as the prototype does. */
const isId = (v: unknown): v is string => typeof v === 'string';

/** The stored `learn`, tolerant of an empty or odd record; `start` is null until the daily read was first shown. */
export function readLearn(raw: Record<string, unknown>): { start: string | null; read: string[] } {
  return { start: isId(raw.start) ? raw.start : null, read: Array.isArray(raw.read) ? raw.read.filter(isId) : [] };
}

/** `learn` after the card was opened, or null when it was already read (nothing to write). Keeps any other keys; starts the clock if unset. */
export function withRead(raw: Record<string, unknown>, id: string, today: string): Record<string, unknown> | null {
  const l = readLearn(raw);
  if (l.read.includes(id)) return null;
  return { ...raw, start: l.start ?? today, read: [...l.read, id] };
}
