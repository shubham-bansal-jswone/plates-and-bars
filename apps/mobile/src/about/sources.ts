import { chosenEatout, chosenFoods } from '../food/catalog';
import { perLoad } from '../content/reader';
import { chosenRaw } from '../recipes/content';

export interface SourceInfo {
  code: string;
  name: string;
  licence: string;
  url: string | null;
  reference?: string | null;
}

// Foods, eat-out and raw-ingredients sources come from the same accepted-or-rejected bundles the catalog and the recipe
// builder use (never a separate check).

/** One entry per distinct source (code and name), since one code can be recorded under more than one name. */
// A few raw-ingredient rows add "; values match USDA <item>" to the source name; that is a per-row note, not another source.
const baseName = (name: string): string => name.split('; values match')[0]!;
export const sourceKey = (s: { code: string; name: string }): string => `${s.code}|${baseName(s.name)}`;

/**
 * One entry per source key. A reference belongs to one food, so a merged source keeps it only when every row agrees;
 * otherwise it is dropped rather than showing one food's reference for the whole source.
 */
export function mergeSources(rows: readonly (SourceInfo & { reference?: string | null })[]): readonly SourceInfo[] {
  const merged = new Map<string, SourceInfo>();
  for (const s of rows) {
    const key = sourceKey(s);
    const prev = merged.get(key);
    if (!prev) merged.set(key, { code: s.code, name: baseName(s.name), licence: s.licence, url: s.url, reference: s.reference });
    else if (prev.reference !== s.reference) prev.reference = null;
  }
  return [...merged.values()];
}

/** Food data sources, names and licences exactly as recorded on the content rows (ADR 002 and 005). Resolved at first use after the content load. */
export const getFoodSources = perLoad(() => {
  const fromContent = [
    ...chosenFoods().foods.map((f) => f.source),
    ...chosenEatout().cuisines.flatMap((c) => c.dishes.map((d) => d.source)),
    ...chosenRaw().ingredients.map((i) => i.source),
  ];
  return mergeSources(fromContent);
});

/** Fonts bundled with the app. */
export const FONT_SOURCES: readonly SourceInfo[] = [
  { code: 'inter', name: 'Inter (all text, titles and numbers)', licence: 'SIL Open Font License 1.1', url: null },
  { code: 'roboto', name: 'Roboto Light (older headings)', licence: 'SIL Open Font License 1.1', url: null },
];

/** The body map shapes (`workout/bodyMapData.ts`). MIT asks for this notice in every copy of the data. */
export const BODY_MAP_SOURCE: SourceInfo = { code: 'react-body-highlighter', name: 'Body map shapes: react-body-highlighter', licence: 'MIT License, Copyright (c) 2020 GV79', url: 'https://github.com/giavinh79/react-body-highlighter' };
export const BODY_MAP_LICENCE =
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';

export const ABOUT_COPY = {
  title: 'About and sources',
  intro: 'Where the numbers and content in Plate & Bar come from, and under what licence.',
  privacy: 'Your consent',
  food: 'Food data',
  fonts: 'Fonts',
  drawings: 'Exercise drawings',
  motion: 'Motion',
  filmed: 'Filmed for Plate & Bar',
  sourceLink: 'Source',
  retrieved: (d: string) => `Retrieved ${d}`,
  bodyMap: 'Body map',
  exercises: 'Exercises',
  exercisesText: 'The exercise library and how-to notes are text only. The app shows no exercise photos.',
  licence: (l: string) => `Licence: ${l}`,
};
