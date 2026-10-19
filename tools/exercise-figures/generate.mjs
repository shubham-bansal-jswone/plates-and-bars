// Renders the start and end SVG frames of every exercise the rig has a pose for, and builds the
// content/exercise-images.json bundle (issue #653). Pure: no clock, no randomness, no network.
import { AN } from './rig.mjs';
import { LICENCES } from '../validate/exercise-images.mjs';

// No literal colours: the body uses currentColor, the rest are theme tokens the app (or a stylesheet) defines.
export const COLOURS = { body: 'currentColor', arm: 'var(--fig-arm)', hl: 'var(--fig-hl)', eq: 'var(--fig-eq)', bg: 'var(--fig-bg)' };
export const VIEW = { w: 320, h: 240 };
export const RIG_VERSION = 'rig-v1';
export const AUTHOR = 'Plate & Bar authors';

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** k = 0 is the start pose, k = 1 the end pose. */
export function renderFrame(name, k) {
  // The rig prints most coordinates to 1 decimal but a few props (seat posts) with full precision: round every number
  // to 1 decimal, then "12.0" -> "12" (smaller, and within the validator's digit limit).
  const body = AN.frame(name, k, COLOURS)
    .replace(/-?\d+\.\d{2,}/g, (n) => Number(n).toFixed(1))
    .replace(/-0\.0(?=["\s])/g, '0')
    .replace(/(\d)\.0(?=["\s])/g, '$1');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}">${body}</svg>`;
}

/** Timed holds (catalogue type "time"): one static frame, used as both start and end (#653). tests check each entry against the catalogue. */
export const ISOMETRIC = ['Plank (seconds)', 'Wall Sit (seconds)', 'Single-Leg Balance (seconds)'];

export function buildEntry(name) {
  const id = slug(name);
  const poses = ISOMETRIC.includes(name) ? [['a', 0]] : [['a', 0], ['b', 1]];
  return {
    frames: poses.map(([suffix, k]) => ({ file: `svg/${id}-${suffix}.svg`, w: VIEW.w, h: VIEW.h, svg: renderFrame(name, k) })),
    source: 'own_drawing',
    source_id: `${RIG_VERSION}/${id}`,
    licence: 'CC-BY-4.0',
    licence_url: LICENCES['CC-BY-4.0'],
    author: AUTHOR,
    author_url: null,
    source_url: null,
    changes: null,
    alt: null,
    note: null,
  };
}

/** @param exerciseNames names in exercises.json order; the bundle keeps that order and skips exercises with no pose */
export function buildBundle(exerciseNames) {
  const images = {};
  for (const name of exerciseNames) if (AN.has(name)) images[name] = buildEntry(name);
  return { schema_version: 1, images };
}

export const serialize = (bundle) => `${JSON.stringify(bundle, null, 2)}\n`;
