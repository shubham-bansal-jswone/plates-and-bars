import foods from '../../../../content/foods.json';
import eatout from '../../../../content/eatout.json';
import raw from '../../../../content/raw-ingredients.json';

export interface SourceInfo {
  code: string;
  name: string;
  licence: string;
  url: string | null;
}

interface Src { code: string; name: string; licence: string; url: string | null }
const fromContent: Src[] = [
  ...(foods as unknown as { foods: { source: Src }[] }).foods.map((f) => f.source),
  ...(eatout as unknown as { cuisines: { dishes: { source: Src }[] }[] }).cuisines.flatMap((c) => c.dishes.map((d) => d.source)),
  ...(raw as unknown as { ingredients: { source: Src }[] }).ingredients.map((i) => i.source),
];

/** Food data sources, names and licences exactly as recorded on the content rows (ADR 002 and 005), one entry per source code. */
export const FOOD_SOURCES: readonly SourceInfo[] = [...new Map(fromContent.map((s) => [s.code, { code: s.code, name: s.name, licence: s.licence, url: s.url }])).values()];

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
