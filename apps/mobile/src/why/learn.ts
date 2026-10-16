import { daysBetween } from '@plate-and-bar/core';
import { chosenCards, whyCard, type WhyCard } from './cards';

/** `Settings.learn` is an open object in the contract; the app keeps `{ start, read }` in it, as the prototype does. */
/** Days between daily reads (prototype `learnCardHtml`: one more card every 3 days). */
const DAYS_PER_CARD = 3;
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

/** The daily-read order (prototype `learnCardHtml`): by `learn_order`, audience cards set in at `learn_insert_at` (only for that audience; the index counts held-back cards too, as the prototype list did), held-back cards then left out. */
export function learnList(sex: string | undefined): WhyCard[] {
  const all = chosenCards().cards;
  const list = all.filter((c) => typeof c.learn_order === 'number').sort((a, b) => (a.learn_order as number) - (b.learn_order as number));
  for (const c of all.filter((x) => x.audience !== undefined && x.learn_insert_at !== undefined)) {
    if (c.audience === sex) list.splice(c.learn_insert_at as number, 0, c);
  }
  return list.filter((c) => whyCard(c.id) !== null);
}

/** The card due now, and the progress line numbers; `next` is null when everything due is read (or the list is empty). */
export function dailyRead(raw: Record<string, unknown>, sex: string | undefined, today: string): { next: WhyCard | null; readN: number; total: number } {
  const { start, read } = readLearn(raw);
  const list = learnList(sex);
  const due = Math.min(list.length, 1 + Math.floor(daysBetween(start ?? today, today) / DAYS_PER_CARD));
  return { next: list.slice(0, due).find((c) => !read.includes(c.id)) ?? null, readN: list.filter((c) => read.includes(c.id)).length, total: list.length };
}
