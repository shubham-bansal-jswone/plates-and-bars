# exercise-motion

Turns our own filmed clips into `content/exercise-motion.json` (issue #1069): our own 15-joint keyframes, no body model, no third-party video. The bundle ships with no entries; real data comes from the owner's clips. The app player is a separate slice.

```
video --(optional, run-model.py)--> landmarks.json --(cli.mjs)--> entry in content/exercise-motion.json --> coach review --> merge
```

CI never runs the model. It runs `pipeline.mjs` on the committed fixture `fixtures/squat-synthetic.landmarks.json` (a made-up squat, not a person, built by `make-fixture.mjs`) and compares with the golden `fixtures/squat-synthetic.motion.json`.

## Licence check (step 0 of #1069, 2026-10-19)

| Item | Licence | Where it was checked |
| --- | --- | --- |
| MediaPipe Pose Landmarker models (BlazePose GHUM 3D: lite, full, heavy `.task` bundles) | Apache-2.0 | The model card "Model Card BlazePose GHUM 3D" (https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf, dated 16 April 2021, linked from the Pose Landmarker page for all three bundles) says "LICENSED UNDER Apache License, Version 2.0". Out-of-scope uses listed there: several people in frame, subjects further than 4 m, no head in view, applications needing metric-accurate depth, surveillance or identity recognition. We use one person at 2 to 3 m and normalise to body height, so none applies |
| Training data of those weights | Not a research-only set | Same card: 30K consented smartphone-AR images, 85K of them fitness poses (the card's wording is "images, including consented images (30K)... The majority of training images (85K) capture a wide range of fitness poses"); depth comes from fitting the synthetic GHUM body to 2D annotations. This is the same stance as the Apache-2.0 MoveNet weights in `THIRD_PARTY.md` |
| `mediapipe` Python package 1.1.1 and the MediaPipe repository | Apache-2.0 | PyPI classifier "OSI Approved :: Apache Software License"; GitHub licence API for google-ai-edge/mediapipe reports Apache-2.0 |
| Model files used | sha256 `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` (full, 9,398,198 bytes), `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` (heavy, 30,664,242 bytes) | Downloaded from `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{full,heavy}/float16/latest/` on 2026-10-19. `run-model.py` refuses any other hash unless `--allow-unpinned` is passed. The `.task` files are not committed |

Not found: a separate licence file inside the `.task` bundles (they are zip archives of TFLite models). The only licence statement for the weights is the model card line above.

The pipeline itself (`pipeline.mjs`, `cli.mjs`, `make-fixture.mjs`, the validator) has no dependencies. `requirements.txt` pins the optional model step. Licences from PyPI metadata on 2026-10-19:

| Package (pinned) | Licence |
| --- | --- |
| mediapipe 1.1.1 | Apache-2.0 |
| opencv-contrib-python 5.0.0.93 | Apache-2.0 (the wheel also bundles FFmpeg under LGPL; we do not redistribute it, the tool runs on our own machine) |
| numpy 2.5.4 | BSD-3-Clause (plus 0BSD, MIT, Zlib, CC0-1.0 parts) |
| Installed with them: absl-py 2.5.1 (Apache-2.0), certifi 2026.10.18 (MPL-2.0), flatbuffers 25.12.19 (Apache-2.0), matplotlib 3.11.2 (PSF-based matplotlib licence), sounddevice 0.5.6 (MIT), pillow 13.0.0 (MIT-CMU), cffi, contourpy, cycler, fonttools, kiwisolver, packaging, pycparser, pyparsing, python-dateutil, six (all permissive) | OSI open source. `pip install --dry-run -r requirements.txt` resolved on 2026-10-19; the model step itself has not been run end to end yet (no clip exists) |

## How to film

- One person, full body in frame from head to feet, including the hands at the bottom and top of the move. Keep 2 to 3 m between camera and person.
- Two clips per exercise: side view (camera at hip height, person side-on) and front view. One at a time, phone on a tripod, landscape, 30 fps, no zoom.
- Plain, uncluttered background, even light, tight clothing so knees and elbows are visible. No other person in view.
- 3 to 5 clean repetitions at the tempo the coach wants shown, a pause at the start and at the end.
- A signed model release (including consent to a derived stick figure) for anyone who is not the owner. Record the release id and a clip id in the owner's clip register (outside the repo). Only the derived joint numbers are ever committed; the video stays out of the repo.

## How to run

```
# 1. Optional: landmarks from a video (needs Python and requirements.txt; CPU only, a minute or two per clip)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python run-model.py clip.mp4 pose_landmarker_full.task landmarks.json

# 2. Landmarks to an entry (Node 22, no install). From tools/:
node exercise-motion/cli.mjs landmarks.json --exercise "Bodyweight Squat" \
  --clip-id <clip id> --release-id <release id> --author "<credit name>" \
  --merge ../content/exercise-motion.json
```

`--out <file>` writes a one-exercise bundle instead of merging. The command validates before writing and exits non-zero when the clip is rejected (a hidden-landmark gap longer than `--max-gap` frames, too many bad frames, no repetition found, hips edge-on to the camera). A rejected clip means film it again. Other options: `--fps` (default 10), `--no-loop`, `--window`, `--order`, `--min-visibility`, `--licence` (CC-BY-4.0 default), `--author-url`, `--tools`, `--note`. `npm run fixture:motion` rewrites the fixture; `npm run validate:exercise-motion` validates the bundle (`node validate/cli.mjs` runs it too).

## What the pipeline does and its parameters

1. Reads `mediapipe-world-landmarks-v1` JSON: `fps`, optional `indices` (which of the 33 landmarks are stored; 7, 8, 11 to 16 and 23 to 28 are needed), and per frame `[x, y, z, visibility]` per landmark or `null` when no person was found.
2. A landmark is missing when visibility is below 0.5 or its frame is `null`. Bad frames at both ends are trimmed. Inside the clip a gap of up to 5 frames is filled by linear interpolation per landmark; a longer gap, or more than 25 % bad frames, rejects the clip. Nothing is invented across longer gaps.
3. Smoothing: Savitzky-Golay, window 7 frames (about 0.23 s at 30 fps), polynomial order 2, on every coordinate. It has no lag (a One Euro filter would add some offline), passes any quadratic unchanged, and at the ends the window slides inward. Use a smaller window for a lower frame rate.
4. Axes: MediaPipe world is x right, y down, z away from the camera; ours is x = the figure's left, y up, z forward. The whole clip is then turned about the vertical so the hip line lies on +x, so side and front clips give the same motion.
5. Loop trimming (default): the repetition ends at the earliest local minimum of the pose distance back to frame 0 that is within 25 % (plus 0.005) of the best match, at least 1.0 s after the start. No movement, or a pose that never returns, rejects the clip. `--no-loop` keeps the whole clip.
6. Resample to 10 fps (linear). A loop of N frames puts frame k at k/N of the period, so the step from the last frame back to the first is an ordinary step.
7. Retarget to our skeleton `pb15-v1` (head, neck, shoulders, elbows, wrists, spine_mid, hips, knees, ankles): the joints are taken from the landmarks (head = ear midpoint, neck = shoulder midpoint, spine_mid = midpoint of hip centre and neck), the figure is scaled so its bones add up to our table, then every bone is rebuilt with its fixed length from `BONES` in `validate/exercise-motion.mjs` and the measured direction. Bone lengths are therefore constant in every frame (the validator allows 3 % for rounding).
8. Normalise: units are body heights (about 1.0 tall), y = 0 is the floor (lowest ankle in each frame), the ankle midpoint is pinned at x = z = 0 (MediaPipe's origin is the hip centre of each frame, so the body's place in the world comes from the feet). This suits moves where the feet stay put; a step or a jump needs a better foot model. Values are rounded to 3 decimals.

Not done yet (later slices): joint limits, hand pinning to equipment, a preview page. These are the reasons the coach checks every loop.

## Format and size

See `tools/validate/schemas/exercise-motion.schema.json` and `tools/validate/exercise-motion.mjs`. A frame is 45 numbers (15 joints in the schema's order, x y z). Each entry is capped at 8,192 bytes; at 3 decimals that is about 25 to 30 frames, so about 2.5 to 3 s at 10 fps. The fixture entry is 5.4 KB for 20 frames.

## From output to content and coach review

1. Run `cli.mjs --merge ../content/exercise-motion.json` for the exercise. Keys are kept sorted and the file is written one frame per line, so the PR diff shows the new entry only.
2. In `content/`, `node validate/cli.mjs` and `npm test` must pass. The validator needs source `own_filming`, a licence on the allowlist, `clip_id`, `release_id` and a real exercise name.
3. Regenerate `apps/mobile/src/content/bundled.json` (`node scripts/content-meta.mjs` in `apps/mobile`, full-history checkout).
4. Open a content PR. The coach reviews the motion (range of motion, tempo, joint alignment, no unnatural angles) once a preview exists, and signs off on the PR. The motion data is not wired into the app until the flag `EXPO_PUBLIC_EXERCISE_MOTION` slice lands.
