// Validator for content/exercise-images.json (issue #653). Returns a list of error strings.
// Shape: { schema_version: 1, images: { "<exercise name>": { frames, source, source_id, licence, ... } } }.
// The JSON Schema in validate/schemas/exercise-images.schema.json documents the shape; keep the two in step
// (test/exercise-images.test.mjs compares the lists below with the schema).
import { createHash } from 'node:crypto';
import { nonEmpty } from './text.mjs';
import { checkSvgFrame, COLOUR_TOKENS, MAX_SVG_BYTES, svgByteLength } from './svg-allowlist.mjs';

// Own drawings only. A third-party source (wger, Wikimedia Commons) needs an ADR first (issue #653, section 5), and
// this list and the schema enum change together then.
export const SOURCES = ['own_drawing'];
// Allowlist of licences; CC-BY-SA stays out until an ADR accepts it.
export const LICENCES = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
export const MAX_FRAME_BYTES = MAX_SVG_BYTES;
export const MAX_FRAMES = 2;
export const MAX_DIMENSION = 1024;
export const MAX_ALT = 140;
export { COLOUR_TOKENS };
const FIELDS = ['frames', 'source', 'source_id', 'licence', 'licence_url', 'author', 'author_url', 'source_url', 'changes', 'alt', 'note'];
const FRAME_FIELDS = ['file', 'w', 'h', 'svg'];
export const FILE_PATTERN = '^svg/[a-z0-9]+(-[a-z0-9]+)*\\.svg$';
const FILE = new RegExp(FILE_PATTERN);
const isInt = (n) => Number.isInteger(n) && n > 0;
const isHttps = (s) => typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s);
const nullOrString = (v) => v === null || nonEmpty(v);

function checkSvg(svg, w, h, err) {
  if (typeof svg !== 'string') return err('svg must be a string');
  const bytes = svgByteLength(svg);
  if (bytes > MAX_FRAME_BYTES) err(`svg is ${bytes} bytes, the limit is ${MAX_FRAME_BYTES}`);
  for (const e of checkSvgFrame(svg, w, h)) err(e);
}

/**
 * @param content parsed content/exercise-images.json
 * @param exerciseNames the names in content/exercises.json (tags)
 */
export function validateExerciseImages(content, exerciseNames) {
  const errors = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['bundle must be an object'];
  if (content.schema_version !== 1) errors.push('schema_version must be 1');
  for (const k of Object.keys(content)) if (!['schema_version', 'images'].includes(k)) errors.push(`unknown top-level field "${k}"`);
  const images = content.images;
  if (!images || typeof images !== 'object' || Array.isArray(images)) return [...errors, 'images must be an object keyed by exercise name'];
  const names = new Set(exerciseNames);
  const files = new Map();
  const sourceIds = new Map();
  const svgs = new Map();

  for (const [name, im] of Object.entries(images)) {
    const err = (m) => errors.push(`${name}: ${m}`);
    if (!names.has(name)) err('no such exercise in exercises.json');
    if (!im || typeof im !== 'object' || Array.isArray(im)) { err('entry must be an object'); continue; }
    for (const f of FIELDS) if (!(f in im)) err(`field "${f}" missing`);
    for (const k of Object.keys(im)) if (!FIELDS.includes(k)) err(`unknown field "${k}" (AI-generated images are not accepted)`);

    if (!Array.isArray(im.frames) || im.frames.length < 1 || im.frames.length > MAX_FRAMES) err(`frames must be a list of 1 to ${MAX_FRAMES} frames`);
    else im.frames.forEach((fr, i) => {
      const ferr = (m) => err(`frame ${i + 1}: ${m}`);
      if (!fr || typeof fr !== 'object' || Array.isArray(fr)) return ferr('must be an object');
      for (const f of FRAME_FIELDS) if (!(f in fr)) ferr(`field "${f}" missing`);
      for (const k of Object.keys(fr)) if (!FRAME_FIELDS.includes(k)) ferr(`unknown field "${k}"`);
      if (typeof fr.file !== 'string' || !FILE.test(fr.file)) ferr('file must look like svg/<lowercase-slug>.svg');
      else {
        if (files.has(fr.file)) ferr(`duplicate file ${fr.file} (also used by ${files.get(fr.file)})`);
        files.set(fr.file, name);
      }
      for (const d of ['w', 'h']) if (!isInt(fr[d]) || fr[d] > MAX_DIMENSION) ferr(`${d} must be an integer from 1 to ${MAX_DIMENSION}`);
      checkSvg(fr.svg, fr.w, fr.h, ferr);
      if (typeof fr.svg === 'string') {
        const hash = createHash('sha256').update(fr.svg).digest('hex');
        if (svgs.has(hash)) ferr(`same drawing as ${svgs.get(hash)}`);
        else svgs.set(hash, `${name} frame ${i + 1}`);
      }
    });

    if (!SOURCES.includes(im.source)) err(`source must be ${SOURCES.join(', ')} (third-party images need an ADR first)`);
    for (const f of ['source_id', 'licence', 'author']) if (!nonEmpty(im[f])) err(`${f} must be a non-empty string`);
    if (nonEmpty(im.licence)) {
      if (!Object.hasOwn(LICENCES, im.licence)) err(`licence "${im.licence}" is not on the allowlist (${Object.keys(LICENCES).join(', ')})`);
      else if (im.licence_url !== LICENCES[im.licence]) err(`licence_url must be ${LICENCES[im.licence]}`);
    }
    if (nonEmpty(im.source_id)) {
      if (sourceIds.has(im.source_id)) err(`duplicate source_id ${im.source_id} (also ${sourceIds.get(im.source_id)})`);
      sourceIds.set(im.source_id, name);
    }
    for (const u of ['author_url', 'source_url']) if (im[u] !== null && im[u] !== undefined && !isHttps(im[u])) err(`${u} must be an https URL or null`);
    for (const f of ['changes', 'note']) if (f in im && !nullOrString(im[f])) err(`${f} must be a non-empty string or null`);
    if ('alt' in im && !nullOrString(im.alt)) err('alt must be a non-empty string or null');
    else if (typeof im.alt === 'string' && im.alt.length > MAX_ALT) err(`alt is ${im.alt.length} characters, the limit is ${MAX_ALT}`);
  }
  return errors;
}
