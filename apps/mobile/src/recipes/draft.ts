import { presetIngredients, type OilLevel } from '@plate-and-bar/core';
import { MEALS, type Meal } from '../food/types';
import { rawIngredients, type RecipeContent } from './content';
import type { DraftRow } from './IngredientRows';
import type { Recipe } from './types';

/** The recipe being built (prototype `RB`): amounts stay text until core reads them. */
export interface Draft {
  name: string;
  rows: DraftRow[];
  ymode: 'katori' | 'grams';
  katoris: string;
  grams: string;
  /** The starting point chosen, so the oil level can redo its amounts. */
  preset: RecipeContent | null;
  oil: OilLevel;
  /** The library recipe loaded: its tags, time and steps show. */
  lib: RecipeContent | null;
  /** The saved recipe being edited. */
  editing: Recipe | null;
  log: number;
  meal: Meal;
}

export const blankDraft = (): Draft => ({ name: '', rows: [{ ingredient: 'Toor dal (dry)', amount: '', unit: 'g' }], ymode: 'katori', katoris: '4', grams: '', preset: null, oil: 'normal', lib: null, editing: null, log: 1, meal: MEALS[1] });

const asRows = (rows: readonly { ingredient: string; amount: number | string; unit: string }[]): DraftRow[] => rows.map((r) => ({ ingredient: r.ingredient, amount: String(r.amount), unit: r.unit }));

/** Prototype `rbFromPreset`: the preset's rows at the oil level (core's `presetIngredients`), named "<preset> (home-style)" unless kept. */
export function fromPreset(d: Draft, p: RecipeContent, oil: OilLevel, keepName: boolean): Draft {
  return { ...d, preset: p, lib: null, oil, name: keepName ? d.name : `${p.name} (home-style)`, rows: asRows(presetIngredients(p.ingredients, oil, rawIngredients)), ymode: 'katori', katoris: String(p.katoris) };
}

/** Prototype `loadLibrary`. */
export function fromLibrary(d: Draft, l: RecipeContent): Draft {
  return { ...d, name: l.name, rows: asRows(l.ingredients), ymode: 'katori', katoris: String(l.katoris), grams: '', preset: null, editing: null, log: 1, lib: l };
}

/** Prototype `case 'rb-load'`. */
export function fromRecipe(d: Draft, r: Recipe): Draft {
  return { ...d, name: r.name, rows: asRows(r.ingredients), ymode: r.yield_mode, katoris: r.katoris === null ? '' : String(r.katoris), grams: r.cooked_g === null ? '' : String(r.cooked_g), oil: r.oil === 'low' || r.oil === 'rich' ? r.oil : 'normal', preset: null, lib: null, editing: r, log: 1 };
}
