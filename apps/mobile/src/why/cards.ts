import cardsContent from '../../../../content/cards.json';
import { contentReader, isArrOf, isObj, isStr, isTrimmedText } from '../content/reader';

/** One "Why it works" card (content/cards.json), reduced to what the sheet shows. */
export interface WhyCard {
  id: string;
  title: string;
  summary: string;
  body: string;
  evidence: 'Strong' | 'Moderate' | 'Emerging';
  source: string;
  review_status: 'draft' | 'reviewed';
  placeholders?: string[];
  sections?: string[];
}
interface CardsBundle { cards: WhyCard[] }

/**
 * Cards held back until their sources are decided (issue #212: only generic sources are cited). Remove an id here when the
 * issue is settled; the card then shows wherever its link is placed.
 */
export const HIDDEN_CARDS: readonly string[] = ['ramp', 'ladder', 'formfirst'];

const TEXT_MAX = 5000;
const shippedIds = (cardsContent as unknown as CardsBundle).cards.map((c) => c.id);
const name = (v: unknown): v is string => isStr(v) && /^[a-z][a-z0-9_]*$/.test(v) && v.length <= 40;

// Mirrors tools/validate/cards.mjs (shape, evidence, snake-case id, unique id and title); additions and edits are allowed,
// but every shipped id stays, since screens link to cards by id. Body brace syntax is left to the renderer, which ignores
// what it does not understand.
function isCard(v: unknown): v is WhyCard {
  return (
    isObj(v) && name(v.id) && isTrimmedText(300)(v.title) && isTrimmedText(1000)(v.summary) && isTrimmedText(TEXT_MAX)(v.body) &&
    isTrimmedText(1000)(v.source) && (v.evidence === 'Strong' || v.evidence === 'Moderate' || v.evidence === 'Emerging') &&
    (v.review_status === 'draft' || v.review_status === 'reviewed') &&
    (v.placeholders === undefined || isArrOf(v.placeholders, name)) && (v.sections === undefined || isArrOf(v.sections, name))
  );
}
export const isCards = (v: unknown): v is CardsBundle => {
  if (!isObj(v) || !Array.isArray(v.cards) || !v.cards.every(isCard)) return false;
  const ids = new Set(v.cards.map((c: WhyCard) => c.id));
  const titles = new Set(v.cards.map((c: WhyCard) => c.title));
  return ids.size === v.cards.length && titles.size === v.cards.length && shippedIds.every((id) => ids.has(id));
};

/** The single accept or reject decision for the cards bundle. */
export const chosenCards = contentReader('cards', cardsContent as unknown as CardsBundle, isCards);

/** A card by id, or null when there is none or it is held back. Call it where it is used, not at module level. */
export function whyCard(id: string): WhyCard | null {
  return HIDDEN_CARDS.includes(id) ? null : chosenCards().cards.find((c) => c.id === id) ?? null;
}

/** Values for a card's `{placeholder}`s and `{?section}`s; a missing value turns its section off (or shows its `{:}` part). */
export type WhyValues = Record<string, string | number | undefined>;
const has = (values: WhyValues, k: string): boolean => Object.prototype.hasOwnProperty.call(values, k) && values[k] !== undefined;

/** Fills a card body: `{?s}on{:}off{/s}` sections first, then `{name}` placeholders. */
export function renderBody(body: string, values: WhyValues = {}): string {
  return body
    .replace(/\{\?([a-z_]+)\}([\s\S]*?)\{\/\1\}/g, (_m, s: string, inner: string) => {
      const [on = '', off = ''] = inner.split('{:}');
      return has(values, s) ? on : off;
    })
    .replace(/\{([a-z_]+)\}/g, (_m, k: string) => (has(values, k) ? String(values[k]) : ''));
}
