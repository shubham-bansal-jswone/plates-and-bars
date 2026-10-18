import { applyFit, presetIngredients, type FitSuggestion, type OilLevel } from '@plate-and-bar/core';
import type { ImportedRecipe } from '../ai/recipeImport';
import type { Meal } from '../food/types';
import { getRawIngredients, type RecipeContent } from './content';
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
  /** Steps of an imported recipe (a library recipe's come from `lib`). */
  importedSteps: string[];
  /** Ingredients of an imported recipe that could not be matched, for the user to add by hand. */
  importedUnmatched: string[];
}

export const blankDraft = (meal: Meal): Draft => ({ name: '', rows: [{ ingredient: 'Toor dal (dry)', amount: '', unit: 'g' }], ymode: 'katori', katoris: '4', grams: '', preset: null, oil: 'normal', lib: null, editing: null, log: 1, meal, importedSteps: [], importedUnmatched: [] });

const asRows = (rows: readonly { ingredient: string; amount: number | string; unit: string }[]): DraftRow[] => rows.map((r) => ({ ingredient: r.ingredient, amount: String(r.amount), unit: r.unit }));

/** Prototype `rbFromPreset`: the preset's rows at the oil level (core's `presetIngredients`), named "<preset> (home-style)" unless kept. */
export function fromPreset(d: Draft, p: RecipeContent, oil: OilLevel, keepName: boolean): Draft {
  return { ...d, preset: p, lib: null, oil, name: keepName ? d.name : `${p.name} (home-style)`, rows: asRows(presetIngredients(p.ingredients, oil, getRawIngredients())), ymode: 'katori', katoris: String(p.katoris), importedSteps: [], importedUnmatched: [] };
}

/** Prototype `loadLibrary`. */
export function fromLibrary(d: Draft, l: RecipeContent): Draft {
  return { ...d, name: l.name, rows: asRows(l.ingredients), ymode: 'katori', katoris: String(l.katoris), grams: '', preset: null, editing: null, log: 1, lib: l, importedSteps: [], importedUnmatched: [] };
}

/** Prototype `case 'rb-load'`. */
export function fromRecipe(d: Draft, r: Recipe): Draft {
  return { ...d, name: r.name, rows: asRows(r.ingredients), ymode: r.yield_mode, katoris: r.katoris === null ? '' : String(r.katoris), grams: r.cooked_g === null ? '' : String(r.cooked_g), oil: r.oil === 'low' || r.oil === 'rich' ? r.oil : 'normal', preset: null, lib: null, editing: r, log: 1, importedSteps: [], importedUnmatched: [] };
}

/** Prototype `case 'fit-oil'` and `case 'fit-soya'`: the draft after "Apply" on a "Make it fit" suggestion (rows from core's `applyFit`). */
export const withFit = (d: Draft, kind: FitSuggestion['kind']): Draft => ({ ...d, rows: asRows(applyFit(kind, d.rows, getRawIngredients())) });

/** An imported recipe (AI) as a new draft: its rows, katoris and steps; nothing is saved until the user saves. */
export const fromImport = (d: Draft, r: ImportedRecipe): Draft => ({ ...d, name: r.name, rows: r.rows, ymode: 'katori', katoris: r.katoris, grams: '', preset: null, lib: null, editing: null, oil: 'normal', log: 1, importedSteps: r.steps, importedUnmatched: r.unmatched });
