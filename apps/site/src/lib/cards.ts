// The science cards for the blog, read at build time from content/cards.json: the same file the app ships.
import bundle from "../../../../content/cards.json";
import { isHeldBack } from "./held-back.mjs";
import { SENTENCE_SPLIT } from "./sentences.mjs";

export interface Card {
  id: string;
  title: string;
  summary: string;
  body: string;
  evidence: "Strong" | "Moderate" | "Emerging";
  source: string;
  review_status: "draft" | "reviewed";
  /** `true` for a card held back until its sources are decided (#212); the app reads the same flag. */
  hidden?: true;
  hidden_reason?: string;
}

/** Same wording as the app's Why sheet. */
export const EVIDENCE_NOTE = {
  Strong: "Many studies agree.",
  Moderate: "Good support, some open questions.",
  Emerging: "Early or limited research.",
} as const;

const all = (bundle as unknown as { cards: Card[] }).cards;
export const cards: Card[] = all.filter((c) => !isHeldBack(c));
export const hiddenCount = all.length - cards.length;

export interface Rendered {
  paragraphs: string[];
  /** True when text that depends on the reader's own numbers was left out. */
  trimmed: boolean;
}

/**
 * The card body with no profile: `{?s}on{:}off{/s}` sections take their "off" part, and any sentence that still holds a
 * `{placeholder}` (it needs the reader's own numbers) is left out. Nothing is added to the card text.
 */
export function renderBody(body: string): Rendered {
  let trimmed = false;
  const text = body
    .replace(/\{\?([a-z_]+)\}([\s\S]*?)\{\/\1\}/g, (_m, _s: string, inner: string) => {
      const [on = "", off = ""] = inner.split("{:}");
      if (on.includes("{")) trimmed = true;
      return off;
    })
    // a parenthetical that only gives a personal number: "(130 g)" style, e.g. " ({protein_g} g)"
    .replace(/ \([^()]*\{[a-z_]+\}[^()]*\)/g, () => {
      trimmed = true;
      return "";
    });
  // split after . ! ? before a capital or digit, but not after an abbreviation such as "e.g." or "et al."
  const kept = text.split(SENTENCE_SPLIT).filter((s) => {
    if (!/\{[a-z_]+\}/.test(s)) return true;
    trimmed = true;
    return false;
  });
  return { paragraphs: [kept.join(" ")], trimmed };
}
