import cards from '../../../../content/cards.json';

/** The cards the target numbers come from (content/cards.json ids). */
export const ASK_CARDS = ['targets', 'protein'] as const;

/** A card's title from the bundle; the id itself when the bundle has no such card. */
export const cardTitle = (id: string): string => (cards.cards as { id: string; title: string }[]).find((x) => x.id === id)?.title ?? id;
