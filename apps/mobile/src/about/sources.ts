import foods from '../../../../content/foods.json';
import eatout from '../../../../content/eatout.json';
import raw from '../../../../content/raw-ingredients.json';
import { contentReader, perLoad, isArrOf, isObj, isStr, isStrOrNull } from '../content/reader';

export interface SourceInfo {
  code: string;
  name: string;
  licence: string;
  url: string | null;
  reference?: string | null;
}

interface Src { code: string; name: string; licence: string; url: string | null; reference?: string | null }
const isSrc = (v: unknown): v is Src => isObj(v) && isStr(v.code) && isStr(v.name) && isStr(v.licence) && isStrOrNull(v.url) && (v.reference === undefined || isStrOrNull(v.reference));
const hasSource = (v: unknown): v is { source: Src } => isObj(v) && isSrc(v.source);

// Only the `source` of each row is read here, so only that is checked.
const isFoodsSrc = (v: unknown): v is { foods: { source: Src }[] } => isObj(v) && isArrOf(v.foods, hasSource);
const isEatoutSrc = (v: unknown): v is { cuisines: { dishes: { source: Src }[] }[] } =>
  isObj(v) && isArrOf(v.cuisines, (c): c is { dishes: { source: Src }[] } => isObj(c) && isArrOf(c.dishes, hasSource));
const isRawSrc = (v: unknown): v is { ingredients: { source: Src }[] } => isObj(v) && isArrOf(v.ingredients, hasSource);

const foodsSrc = contentReader('foods', foods as unknown as { foods: { source: Src }[] }, isFoodsSrc, (b) => b.foods.map((f) => f.source));
const eatoutSrc = contentReader('eatout', eatout as unknown as { cuisines: { dishes: { source: Src }[] }[] }, isEatoutSrc, (b) => b.cuisines.flatMap((c) => c.dishes.map((d) => d.source)));
const rawSrc = contentReader('raw-ingredients', raw as unknown as { ingredients: { source: Src }[] }, isRawSrc, (b) => b.ingredients.map((i) => i.source));

/** One entry per distinct source (code and name), since one code can be recorded under more than one name. */
// A few raw-ingredient rows add "; values match USDA <item>" to the source name; that is a per-row note, not another source.
const baseName = (name: string): string => name.split('; values match')[0]!;
export const sourceKey = (s: { code: string; name: string }): string => `${s.code}|${baseName(s.name)}`;

/** Food data sources, names and licences exactly as recorded on the content rows (ADR 002 and 005). Resolved at first use after the content load. */
export const getFoodSources = perLoad(() => {
  const fromContent = [...foodsSrc(), ...eatoutSrc(), ...rawSrc()];
  return [...new Map(fromContent.map((s) => [sourceKey(s), { code: s.code, name: baseName(s.name), licence: s.licence, url: s.url, reference: s.reference }])).values()] as readonly SourceInfo[];
});

/** Fonts bundled with the app (docs/design/DESIGN.md section 4.1). */
export const FONT_SOURCES: readonly SourceInfo[] = [
  { code: 'inter', name: 'Inter (body and UI text)', licence: 'SIL Open Font License 1.1', url: null },
  { code: 'roboto', name: 'Roboto (headlines and big numbers)', licence: 'SIL Open Font License 1.1', url: null },
];

export const ABOUT_COPY = {
  title: 'About and sources',
  intro: 'Where the numbers and content in Plate & Bar come from, and under what licence.',
  food: 'Food data',
  fonts: 'Fonts',
  exercises: 'Exercises',
  exercisesText: 'The exercise library and how-to notes are text only. The app shows no exercise photos.',
  licence: (l: string) => `Licence: ${l}`,
};
