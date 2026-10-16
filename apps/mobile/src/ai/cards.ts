import { whyCard } from '../why/cards';

/** The cards the target numbers come from (content/cards.json ids). */
export const ASK_CARDS = ['targets', 'protein'] as const;

/** A card's title from the validated cards bundle; the id itself when the bundle has no such card. */
export const cardTitle = (id: string): string => whyCard(id)?.title ?? id;
