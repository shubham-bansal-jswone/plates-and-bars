// The blog shows the cards the app shows: a card with `hidden: true` in content/cards.json is held back (#212, #969).
// Anything else, including a card with no `hidden` field, is shown.
export const isHeldBack = (card) => card.hidden === true;
