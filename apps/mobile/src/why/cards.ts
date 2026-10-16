import cardsContent from '../../../../content/cards.json';
import { has, isProtoName } from '../content/own';
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
  learn_order?: number | null;
  learn_insert_at?: number;
  /** Who the card is for (`female`: shown in the daily read only for them); absent means everyone. */
  audience?: string;
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
const name = (v: unknown): v is string => isStr(v) && /^[a-z][a-z0-9_]*$/.test(v) && v.length <= 40 && !isProtoName(v);

// Mirrors tools/validate/cards.mjs: shape, evidence, snake-case unique id, unique title, learn_order (integer or null,
// unique), learn_insert_at, and the body syntax (`bodyErrors` below). Additions and edits are allowed, but every shipped
// id stays, since screens link to cards by id. Names also reject Object.prototype members.

/** Body syntax `{name}`, `{?sec}on{/sec}`, `{?sec}on{:}off{/sec}` (not nested); true when it is well formed. Port of `bodyErrors`. */
function bodyOk(c: { body: string; placeholders?: string[]; sections?: string[] }): boolean {
  const ph = c.placeholders ?? [];
  const secs = c.sections ?? [];
  let opened: string | null = null;
  let elses = 0;
  for (const m of c.body.matchAll(/\{(\?|\/)([a-z_]+)\}|\{:\}/g)) {
    if (m[0] === '{:}') {
      if (opened === null || ++elses > 1) return false;
    } else if (m[1] === '?') {
      if (opened !== null || !secs.includes(m[2] as string)) return false;
      opened = m[2] as string;
      elses = 0;
    } else {
      if (opened !== m[2]) return false;
      opened = null;
    }
  }
  if (opened !== null || !secs.every((x) => c.body.includes(`{?${x}}`))) return false;
  const plain = c.body.replace(/\{[?/]([a-z_]+)\}|\{:\}/g, '');
  const used = new Set([...plain.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] as string));
  if ([...used].some((u) => !ph.includes(u)) || ph.some((p) => !used.has(p))) return false;
  return !/\{[^}]*\}/.test(plain.replace(/\{[a-z_]+\}/g, ''));
}

function isCard(v: unknown): v is WhyCard {
  return (
    isObj(v) && name(v.id) && isTrimmedText(300)(v.title) && isTrimmedText(1000)(v.summary) && isTrimmedText(TEXT_MAX)(v.body) &&
    isTrimmedText(1000)(v.source) && (v.evidence === 'Strong' || v.evidence === 'Moderate' || v.evidence === 'Emerging') &&
    (v.review_status === 'draft' || v.review_status === 'reviewed') &&
    (v.placeholders === undefined || isArrOf(v.placeholders, name)) && (v.sections === undefined || isArrOf(v.sections, name)) &&
    (v.learn_order === null || Number.isInteger(v.learn_order)) &&
    (v.learn_insert_at === undefined || Number.isInteger(v.learn_insert_at)) &&
    bodyOk(v as { body: string; placeholders?: string[]; sections?: string[] })
  );
}
export const isCards = (v: unknown): v is CardsBundle => {
  if (!isObj(v) || !Array.isArray(v.cards) || v.cards.length === 0 || !v.cards.every(isCard)) return false;
  const cs = v.cards as WhyCard[];
  const ids = new Set(cs.map((c) => c.id));
  const titles = new Set(cs.map((c) => c.title));
  const orders = cs.map((c) => c.learn_order).filter((o) => o !== undefined && o !== null);
  return ids.size === cs.length && titles.size === cs.length && new Set(orders).size === orders.length && shippedIds.every((id) => ids.has(id));
};

/** The single accept or reject decision for the cards bundle. */
export const chosenCards = contentReader('cards', cardsContent as unknown as CardsBundle, isCards);

/** A card by id, or null when there is none or it is held back. Call it where it is used, not at module level. */
export function whyCard(id: string): WhyCard | null {
  return HIDDEN_CARDS.includes(id) ? null : chosenCards().cards.find((c) => c.id === id) ?? null;
}

/** Values for a card's `{placeholder}`s and `{?section}`s; a missing value turns its section off (or shows its `{:}` part). */
export type WhyValues = Record<string, string | number | undefined>;
const given = (values: WhyValues, k: string): boolean => has(values, k) && values[k] !== undefined;

/** Fills a card body: `{?s}on{:}off{/s}` sections first, then `{name}` placeholders. */
export function renderBody(body: string, values: WhyValues = {}): string {
  return body
    .replace(/\{\?([a-z_]+)\}([\s\S]*?)\{\/\1\}/g, (_m, s: string, inner: string) => {
      const [on = '', off = ''] = inner.split('{:}');
      return given(values, s) ? on : off;
    })
    .replace(/\{([a-z_]+)\}/g, (_m, k: string) => (given(values, k) ? String(values[k]) : ''));
}
