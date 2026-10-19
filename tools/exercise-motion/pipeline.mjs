// Landmarks to keyframes (issue #1069). Pure functions: no clock, no randomness, no network, no dependencies.
//
// Input: MediaPipe Pose Landmarker 3D world landmarks saved as JSON (format "mediapipe-world-landmarks-v1", written by
// run-model.py or by make-fixture.mjs). Output: one entry of content/exercise-motion.json.
//
// Steps, in order (all parameters are in DEFAULTS and documented in README.md):
//   1. read and check the file; mark a landmark "bad" when its visibility is below minVisibility or its frame is null
//   2. trim bad frames at both ends; reject the clip when too many frames are bad or an inner gap is longer than maxGapFrames;
//      fill shorter gaps by linear interpolation, per landmark
//   3. smooth every coordinate with a Savitzky-Golay filter (window, order)
//   4. convert axes (x: left, y: up, z: forward), then turn the whole clip about the vertical so the hip line lies on +x
//      (a side-on and a front-on clip give the same motion)
//   5. trim to one repetition (loop): the earliest local minimum of the distance back to frame 0 that is nearly as good as the best
//   6. resample to outputFps (linear)
//   7. retarget to our skeleton: build the 15 joints from the landmarks, scale so the figure is 1.0 tall, then rebuild every
//      bone with the fixed length from the skeleton table, keeping its direction
//   8. put the figure on the floor and pin the ankle midpoint at x = z = 0 (MediaPipe's origin is the hip centre of each frame, so the world
//      position of the body is recovered from the feet); round to 3 decimals
import { JOINTS, BONES, SKELETON_ID, MIN_FPS, MAX_FPS } from '../validate/exercise-motion.mjs';

export const FORMAT = 'mediapipe-world-landmarks-v1';
export class PipelineError extends Error {}

export const DEFAULTS = {
  minVisibility: 0.5,      // below this a landmark is treated as missing (MediaPipe visibility is 0 to 1)
  maxGapFrames: 5,         // longest run of missing frames that is filled; longer is rejected
  maxBadFraction: 0.25,    // reject the clip when more than this share of frames has a missing landmark
  window: 7,               // Savitzky-Golay window in source frames (odd); 7 frames is about 0.23 s at 30 fps
  order: 2,                // Savitzky-Golay polynomial order
  outputFps: 10,           // keyframe rate written to the file
  loop: true,              // trim to one repetition
  minPeriodSeconds: 1.0,   // shortest repetition accepted
  loopTolerance: 1.25,     // a loop end within this factor of the best match counts as "nearly as good"
  decimals: 3,
};

// MediaPipe Pose landmark indices used (BlazePose 33-point topology).
const LM = { l_ear: 7, r_ear: 8, l_shoulder: 11, r_shoulder: 12, l_elbow: 13, r_elbow: 14, l_wrist: 15, r_wrist: 16,
  l_hip: 23, r_hip: 24, l_knee: 25, r_knee: 26, l_ankle: 27, r_ankle: 28 };
export const USED = Object.values(LM);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** Solve A x = b by Gaussian elimination with partial pivoting (tiny systems only). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Savitzky-Golay smoothing by local least squares: each point is the value at its own position of the polynomial of `order`
 * fitted to `window` points around it. Near the ends the window slides inward (it stays `window` points wide), so the
 * result has no lag and no shortened tails. Exact for any polynomial up to `order`.
 */
export function savitzkyGolay(values, window, order) {
  const n = values.length;
  if (window % 2 === 0 || window < order + 1) throw new PipelineError('window must be odd and larger than the order');
  if (n < window) throw new PipelineError(`need at least ${window} frames to smooth, got ${n}`);
  const half = (window - 1) / 2;
  const weights = new Map(); // by the point's offset inside the window
  const weightsFor = (offset) => {
    if (!weights.has(offset)) {
      // Fit y(x) = sum c_k x^k over x = j - offset, j = 0..window-1; the value at x = 0 is c_0.
      const V = Array.from({ length: window }, (_, j) => Array.from({ length: order + 1 }, (_, k) => (j - offset) ** k));
      const AtA = Array.from({ length: order + 1 }, (_, r) => Array.from({ length: order + 1 }, (_, c) => V.reduce((s, row) => s + row[r] * row[c], 0)));
      const w = Array.from({ length: window }, (_, j) => solve(AtA, V[j].map((v) => v))[0]);
      // w[j] above is c_0 of the fit to the unit vector e_j, taken from the normal equations A^T A c = A^T e_j.
      weights.set(offset, w);
    }
    return weights.get(offset);
  };
  return values.map((_, i) => {
    const start = Math.min(Math.max(i - half, 0), n - window);
    const w = weightsFor(i - start);
    let s = 0;
    for (let j = 0; j < window; j++) s += w[j] * values[start + j];
    return s;
  });
}

function readInput(input) {
  if (!input || input.format !== FORMAT) throw new PipelineError(`format must be ${FORMAT}`);
  if (!Number.isFinite(input.fps) || input.fps <= 0) throw new PipelineError('fps must be a positive number');
  if (!Array.isArray(input.frames)) throw new PipelineError('frames must be a list');
  const indices = input.indices ?? Array.from({ length: 33 }, (_, i) => i);
  const col = new Map(indices.map((idx, k) => [idx, k]));
  for (const idx of USED) if (!col.has(idx)) throw new PipelineError(`landmark ${idx} is missing from the file`);
  const frames = input.frames.map((fr, n) => {
    if (fr === null) return null;
    if (!Array.isArray(fr) || fr.length !== indices.length || fr.some((l) => !Array.isArray(l) || l.length < 4 || l.slice(0, 4).some((v) => !Number.isFinite(v)))) {
      throw new PipelineError(`frame ${n} must be null or ${indices.length} landmarks of [x, y, z, visibility]`);
    }
    return fr;
  });
  return { fps: input.fps, frames, col };
}

/** Steps 1 and 2: returns per-used-landmark tracks [landmark][frame] = [x, y, z], with gaps filled. */
function cleanTracks({ frames, col }, o) {
  const bad = (n, idx) => frames[n] === null || frames[n][col.get(idx)][3] < o.minVisibility;
  const frameBad = (n) => USED.some((idx) => bad(n, idx));
  let a = 0, b = frames.length - 1;
  while (a <= b && frameBad(a)) a++;
  while (b >= a && frameBad(b)) b--;
  if (b - a + 1 < o.window) throw new PipelineError(`only ${Math.max(b - a + 1, 0)} usable frames, need at least ${o.window}`);
  let badCount = 0;
  for (let n = a; n <= b; n++) if (frameBad(n)) badCount++;
  if (badCount / (b - a + 1) > o.maxBadFraction) throw new PipelineError(`${badCount} of ${b - a + 1} frames have a hidden landmark, more than ${o.maxBadFraction * 100}%`);
  const tracks = USED.map((idx) => {
    const t = [];
    for (let n = a; n <= b; n++) t.push(bad(n, idx) ? null : frames[n][col.get(idx)].slice(0, 3));
    for (let n = 0; n < t.length; n++) {
      if (t[n]) continue;
      let m = n;
      while (t[m] === null) m++;
      const gap = m - n;
      if (gap > o.maxGapFrames) throw new PipelineError(`gap of ${gap} frames in landmark ${idx} (the limit is ${o.maxGapFrames}); film the clip again`);
      for (let k = n; k < m; k++) {
        const f = (k - n + 1) / (gap + 1);
        t[k] = t[n - 1].map((v, i) => v + (t[m][i] - v) * f);
      }
      n = m;
    }
    return t;
  });
  return Object.fromEntries(USED.map((idx, k) => [idx, tracks[k]]));
}

/** Step 3. */
function smooth(tracks, o) {
  const out = {};
  for (const [idx, t] of Object.entries(tracks)) {
    const axes = [0, 1, 2].map((d) => savitzkyGolay(t.map((p) => p[d]), o.window, o.order));
    out[idx] = t.map((_, n) => [axes[0][n], axes[1][n], axes[2][n]]);
  }
  return out;
}

/** Step 4: MediaPipe world is x right, y down, z away from the camera (a proper rotation to ours: x left, y up, z forward). */
function align(tracks) {
  const conv = {};
  for (const [idx, t] of Object.entries(tracks)) conv[idx] = t.map(([x, y, z]) => [x, -y, -z]);
  const n = conv[LM.l_hip].length;
  let hx = 0, hz = 0;
  for (let k = 0; k < n; k++) {
    const d = sub(conv[LM.l_hip][k], conv[LM.r_hip][k]);
    hx += d[0]; hz += d[2];
  }
  if (Math.hypot(hx, hz) < 1e-6) throw new PipelineError('the hips are edge-on to the camera in every frame; film from the side or the front');
  const theta = Math.atan2(hz, hx); // angle of the hip line from +x, about the vertical
  const c = Math.cos(theta), s = Math.sin(theta);
  const out = {};
  for (const [idx, t] of Object.entries(conv)) out[idx] = t.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c]);
  return out;
}

const hipMid = (tr, k) => mid(tr[LM.l_hip][k], tr[LM.r_hip][k]);
function poseVector(tr, k) {
  const h = hipMid(tr, k);
  return USED.flatMap((idx) => { const p = tr[idx][k]; return [p[0] - h[0], p[1], p[2] - h[2]]; });
}

/** Step 5: returns the number of source frames in one repetition (frame `end` is about frame 0 again). */
function findPeriod(tr, n, fps, o) {
  const min = Math.ceil(o.minPeriodSeconds * fps);
  if (n < min + 2) throw new PipelineError('no repetition found: the clip is shorter than one repetition');
  const v0 = poseVector(tr, 0);
  const d = [];
  for (let k = 0; k < n; k++) {
    const v = poseVector(tr, k);
    d.push(Math.sqrt(v.reduce((s, x, i) => s + (x - v0[i]) ** 2, 0) / USED.length));
  }
  let range = 0;
  for (let k = 0; k < n; k++) range = Math.max(range, d[k]);
  if (range < 0.02) throw new PipelineError('no movement found in the clip');
  const cands = [];
  for (let k = min; k < n - 1; k++) if (d[k] <= d[k - 1] && d[k] <= d[k + 1]) cands.push(k);
  if (!cands.length) throw new PipelineError('no repetition found: the pose never returns to where it started');
  const best = Math.min(...cands.map((k) => d[k]));
  const end = cands.find((k) => d[k] <= best * o.loopTolerance + 0.005);
  if (d[end] > range * 0.35) throw new PipelineError('no repetition found: the pose never returns close to where it started');
  return end;
}

/** Steps 6 to 8. `times` are source-frame positions (floats) of each output frame. */
function retarget(tr, times, o) {
  const at = (idx, t) => {
    const k = Math.min(Math.floor(t), tr[idx].length - 2), f = t - k;
    return tr[idx][k].map((v, i) => v + (tr[idx][k + 1][i] - v) * f);
  };
  const raw = times.map((t) => {
    const P = Object.fromEntries(Object.entries(LM).map(([name, idx]) => [name, at(idx, t)]));
    const hips = mid(P.l_hip, P.r_hip);
    const neck = mid(P.l_shoulder, P.r_shoulder);
    return { head: mid(P.l_ear, P.r_ear), neck, spine_mid: mid(hips, neck), ...Object.fromEntries(
      ['l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle'].map((j) => [j, P[j]])) };
  });
  // Scale: our figure's total bone length over the median measured one, so the person comes out about 1.0 tall.
  const ours = BONES.reduce((s, b) => s + b[2], 0);
  const measured = BONES.reduce((s, [p, c]) => s + median(raw.map((f) => norm(sub(f[c], f[p])))), 0);
  const scale = ours / measured;
  const frames = raw.map((f) => {
    const out = { spine_mid: f.spine_mid.map((v) => v * scale) };
    for (const [p, c, len] of BONES) {
      const d = sub(f[c], f[p]);
      const l = norm(d);
      if (l < 1e-9) throw new PipelineError(`bone ${p}-${c} has zero length in the source`);
      out[c] = out[p].map((v, i) => v + (d[i] / l) * len);
    }
    return out;
  });
  // Floor and feet: the lowest ankle sits on y = 0 and the ankle midpoint on x = z = 0 in every frame (the feet stay put).
  return frames.map((f) => {
    const m = mid(f.l_ankle, f.r_ankle);
    const shift = [-m[0], -Math.min(f.l_ankle[1], f.r_ankle[1]), -m[2]];
    const r = (v) => Math.round(v * 10 ** o.decimals) / 10 ** o.decimals + 0;
    return JOINTS.flatMap((j) => f[j].map((v, i) => r(v + shift[i])));
  });
}

/**
 * @param input parsed landmarks file
 * @param options DEFAULTS overrides, plus provenance: source, source_id, clip_id, release_id, licence, author, tools, note, author_url
 * @returns one entry of content/exercise-motion.json (key order fixed)
 */
export function runPipeline(input, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!Number.isInteger(o.outputFps) || o.outputFps < MIN_FPS || o.outputFps > MAX_FPS) throw new PipelineError(`outputFps must be an integer from ${MIN_FPS} to ${MAX_FPS}`);
  const src = readInput(input);
  const tr = align(smooth(cleanTracks(src, o), o));
  const n = tr[LM.l_hip].length;
  const end = o.loop ? findPeriod(tr, n, src.fps, o) : n - 1;
  const duration = end / src.fps;
  // A loop of N frames: frame k sits at k/N of the period, so the step from the last frame back to the first is a normal one.
  const count = Math.max(2, Math.round(duration * o.outputFps));
  const times = Array.from({ length: count }, (_, k) => (o.loop ? (k * end) / count : (k * end) / (count - 1)));
  const frames = retarget(tr, times, o);
  const licence = o.licence ?? 'CC-BY-4.0';
  const urls = { 'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/' };
  return {
    fps: o.outputFps, loop: o.loop, frames,
    source: o.source ?? 'own_filming', source_id: o.source_id, clip_id: o.clip_id, release_id: o.release_id,
    licence, licence_url: urls[licence] ?? null, author: o.author, author_url: o.author_url ?? null,
    tools: o.tools ?? `exercise-motion pipeline, skeleton ${SKELETON_ID}`, note: o.note ?? null,
  };
}

/** One frame per line, everything else indented by two spaces (matches the other content files' style). */
export function serializeBundle(bundle) {
  const flat = (a) => `[${a.join(', ')}]`;
  const lines = JSON.stringify({ ...bundle, joints: '@J', motions: '@M' }, null, 2).split('\n');
  const motions = Object.entries(bundle.motions);
  const body = motions.length === 0 ? '{}' : `{\n${motions.map(([name, e]) => {
    const fields = Object.entries(e).map(([k, v]) => (k === 'frames'
      ? `      "frames": [\n${v.map((f) => `        ${flat(f)}`).join(',\n')}\n      ]`
      : `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`));
    return `    ${JSON.stringify(name)}: {\n${fields.join(',\n')}\n    }`;
  }).join(',\n')}\n  }`;
  return `${lines.join('\n').replace('"@J"', `[\n${bundle.joints.map((j) => `    ${JSON.stringify(j)}`).join(',\n')}\n  ]`).replace('"@M"', body)}\n`;
}
