import { daysBetween } from './dates';

/** The part of a content/cards.json card the daily read uses (the app's `WhyCard` fits). */
export interface LearnCard {
  id: string;
  /** Place in the daily-read order (prototype `LEARN`); null or absent means not in it. */
  learn_order?: number | null | undefined;
  /** Where an audience card is set into the order, counted against the full list (prototype `list.splice(6, 0, 'bulky')`). */
  learn_insert_at?: number | null | undefined;
  /** Who the card is for (`female`); absent means everyone. */
  audience?: string | null | undefined;
}

/** The stored progress (`Settings.learn`): `start` is null until the daily read was first shown. */
export interface LearnState {
  start: string | null;
  read: readonly string[];
}

export interface DailyRead<C extends LearnCard> {
  /** The first unread card among those due, or null when every due card is read (or the list is empty). */
  next: C | null;
  /** Cards in the list already read (the "N of M done" line). */
  readN: number;
  /** Cards in the list. */
  total: number;
}

/** Days between daily reads (prototype `learnCardHtml`: one more card every 3 days). */
export const LEARN_DAYS_PER_CARD = 3;

/**
 * The daily-read order (prototype `LEARN` and the list built in `learnCardHtml`): cards with a `learn_order`, sorted by it;
 * each audience card with a `learn_insert_at` is set in at that index when its audience is `sex` (the index counts held-back
 * cards too, as the prototype list did); then the `hidden` ids are left out.
 */
export function learnList<C extends LearnCard>(cards: readonly C[], sex: string | null | undefined, hidden: readonly string[] = []): C[] {
  const list = cards.filter((c) => typeof c.learn_order === 'number').sort((a, b) => (a.learn_order as number) - (b.learn_order as number));
  for (const c of cards) {
    if (c.audience != null && typeof c.learn_insert_at === 'number' && c.audience === sex) list.splice(c.learn_insert_at, 0, c);
  }
  return list.filter((c) => !hidden.includes(c.id));
}

/**
 * The card due today and the progress numbers (prototype `learnCardHtml`): `min(n, 1 + floor(max(0, daysBetween(start, today)) / 3))`
 * cards are due, counted from `start` (today when it is unset, as the prototype sets it on first show). A `start` after
 * `today` counts as today, so 1 card is due (#584).
 */
export function dailyRead<C extends LearnCard>(
  cards: readonly C[],
  sex: string | null | undefined,
  learn: LearnState,
  today: string,
  hidden: readonly string[] = [],
): DailyRead<C> {
  const list = learnList(cards, sex, hidden);
  const due = Math.min(list.length, 1 + Math.floor(Math.max(0, daysBetween(learn.start ?? today, today)) / LEARN_DAYS_PER_CARD));
  return {
    next: list.slice(0, due).find((c) => !learn.read.includes(c.id)) ?? null,
    readN: list.filter((c) => learn.read.includes(c.id)).length,
    total: list.length,
  };
}
