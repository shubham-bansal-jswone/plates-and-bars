// Usage: node exercise-motion/cli.mjs <landmarks.json> --exercise "<name>" --clip-id <id> --author "<name>" (--release-id <id> | --source-url <url> --retrieved YYYY-MM-DD)
//          [--source own_filming|cc_licensed] [--source-id <id>] [--licence CC-BY-4.0] [--author-url <https url>] [--note "<text>"]
//          [--fps 10] [--no-loop] [--window 7] [--order 2] [--min-visibility 0.5] [--max-gap 5]
//          (--out <file> | --merge <content/exercise-motion.json>)
// --out writes a one-exercise bundle; --merge adds or replaces the exercise in an existing bundle. Both validate first.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipelineFit, serializeBundle, PipelineError } from './pipeline.mjs';
import { validateExerciseMotion, JOINTS, SKELETON_ID } from '../validate/exercise-motion.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const fail = (m) => { console.error(m); process.exit(1); };

const input = argv.find((a, i) => !a.startsWith('--') && !(argv[i - 1] ?? '').startsWith('--')) ?? fail('usage: cli.mjs <landmarks.json> --exercise <name> ...');
const exercise = opt('exercise') ?? fail('--exercise is required');
for (const r of ['clip-id', 'author']) if (!opt(r)) fail(`--${r} is required (clip register id, author for the credit)`);
const cc = opt('source') === 'cc_licensed';
if (!cc && !opt('release-id')) fail('--release-id is required for own_filming (the signed model release)');
if (cc) for (const r of ['source-url', 'retrieved', 'licence']) if (!opt(r)) fail(`--${r} is required for cc_licensed`);
const num = (name, f) => { const v = opt(name); return v === undefined ? f : Number(v); };

const names = Object.keys(JSON.parse(readFileSync(`${repo}/content/exercises.json`, 'utf8')).tags);
if (!names.includes(exercise)) fail(`${exercise}: no such exercise in exercises.json`);

let entry, requestedFps;
try {
  ({ entry, requestedFps } = runPipelineFit(JSON.parse(readFileSync(input, 'utf8')), {
    source: opt('source', 'own_filming'), source_id: opt('source-id', `clip/${opt('clip-id')}`), clip_id: opt('clip-id'),
    release_id: cc ? null : opt('release-id'), source_url: opt('source-url', null), retrieved: opt('retrieved', null), licence: opt('licence', 'CC-BY-4.0'), author: opt('author'), author_url: opt('author-url', null),
    note: opt('note', null), loop: !flag('no-loop'),
    outputFps: num('fps', 10), window: num('window', 7), order: num('order', 2), minVisibility: num('min-visibility', 0.5), maxGapFrames: num('max-gap', 5),
  }));
} catch (e) {
  if (e instanceof PipelineError) fail(`rejected: ${e.message}`);
  throw e;
}

const target = opt('merge');
const out = opt('out');
if (!target === !out) fail('give exactly one of --out or --merge');
if (target && entry.source === 'synthetic_fixture') fail('--source synthetic_fixture is only for --out; it never goes into a content file');
const bundle = target
  ? JSON.parse(readFileSync(resolve(target), 'utf8'))
  : { schema_version: 1, skeleton: SKELETON_ID, joints: [...JOINTS], motions: {} };
bundle.motions = { ...bundle.motions, [exercise]: entry };
bundle.motions = Object.fromEntries(Object.entries(bundle.motions).sort(([a], [b]) => (a < b ? -1 : 1)));
const errors = validateExerciseMotion(bundle, names, { allowFixture: entry.source === 'synthetic_fixture' });
if (errors.length) fail(`${errors.join('\n')}\nnot written`);
writeFileSync(resolve(target ?? out), serializeBundle(bundle));
if (entry.fps !== requestedFps) console.log(`entry over the size cap at ${requestedFps} fps: stepped the output down to ${entry.fps} fps`);
console.log(`${exercise}: fps ${entry.fps}, ${entry.frames.length} frames, ${Buffer.byteLength(JSON.stringify(entry))} bytes, loop ${entry.loop}`);
