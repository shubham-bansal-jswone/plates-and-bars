import raw from '../../../../content/raw-ingredients.json';
import { chosenEatout, chosenFoods, type FoodSource } from '../food/catalog';
import { perLoad } from '../content/reader';

export interface SourceInfo {
  code: string;
  name: string;
  licence: string;
  url: string | null;
  reference?: string | null;
}

// Foods and eat-out sources come from the same accepted-or-rejected bundles the catalog uses (never a separate check).
// raw-ingredients: recipes still read the shipped copy, so About lists the shipped sources too until #328 moves both to one
// validated reader; they then stay consistent.
const rawSrc = (raw as unknown as { ingredients: { source: Src }[] }).ingredients.map((i) => i.source);
type Src = FoodSource;

/** One entry per distinct source (code and name), since one code can be recorded under more than one name. */
// A few raw-ingredient rows add "; values match USDA <item>" to the source name; that is a per-row note, not another source.
const baseName = (name: string): string => name.split('; values match')[0]!;
export const sourceKey = (s: { code: string; name: string }): string => `${s.code}|${baseName(s.name)}`;

/** Food data sources, names and licences exactly as recorded on the content rows (ADR 002 and 005). Resolved at first use after the content load. */
export const getFoodSources = perLoad(() => {
  const fromContent: Src[] = [
    ...chosenFoods().foods.map((f) => f.source),
    ...chosenEatout().cuisines.flatMap((c) => c.dishes.map((d) => d.source)),
    ...rawSrc,
  ];
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
