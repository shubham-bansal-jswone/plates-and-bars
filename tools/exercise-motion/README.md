# exercise-motion

Turns clips (our own filming, or Creative Commons clips) into `content/exercise-motion.json` (issue #1069): our own 19-joint keyframes (15 body joints plus heels and toes), no body model. Only joint numbers are kept, never video. The bundle ships with no entries; real data comes from the owner's clips. The app player is a separate slice.

```
video --(optional, run-model.py)--> landmarks.json --(cli.mjs)--> entry in content/exercise-motion.json --> coach review --> merge
```

CI never runs the model. It runs `pipeline.mjs` on the committed fixture `fixtures/squat-synthetic.landmarks.json` (a made-up squat, not a person, built by `make-fixture.mjs`) and compares with the golden `fixtures/squat-synthetic.motion.json`.

## Licence check (step 0 of #1069, 2026-10-19)

| Item | Licence | Where it was checked |
| --- | --- | --- |
| MediaPipe Pose Landmarker models (BlazePose GHUM 3D: lite, full, heavy `.task` bundles) | Apache-2.0 | The model card "Model Card BlazePose GHUM 3D" (https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf, dated 16 April 2021, linked from the Pose Landmarker page for all three bundles) says "LICENSED UNDER Apache License, Version 2.0". Out-of-scope uses listed there: several people in frame, subjects further than 4 m, no head in view, applications needing metric-accurate depth, surveillance or identity recognition. We use one person at 2 to 3 m and normalise to body height, so none applies |
| Training data of those weights | Not a research-only set | Same card: the training images include 30K consented images, and most of the 85K training images are fitness poses (the card's wording is "images, including consented images (30K)... The majority of training images (85K) capture a wide range of fitness poses"); depth comes from fitting the synthetic GHUM body to 2D annotations. This is the same stance as the Apache-2.0 MoveNet weights in `THIRD_PARTY.md` |
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

## Where clips come from

- `own_filming` (preferred): see "How to film". Needs the signed model release id (`--release-id`).
- `cc_licensed`: a clip someone else published under CC0-1.0 or CC-BY-4.0. Wikimedia Commons only: `source_url` must be an https URL whose host is exactly `commons.wikimedia.org` or `upload.wikimedia.org`, with no user name, password or port (an allowlist, so YouTube, other video sites and redirector links are all refused). The entry needs `source_url` (the page the clip came from), `retrieved` (the retrieval date, a real calendar date as YYYY-MM-DD, not in the future), `licence`, and `author` as the attribution string the licence asks for (for example "Name, CC BY 4.0, via Wikimedia Commons"); `release_id` is null. Pass `--source cc_licensed --source-url <url> --retrieved <date> --licence <id>` to the CLI.
- Never accepted: NC, ND or share-alike (SA) licences (the validator allowlist has only CC0-1.0 and CC-BY-4.0, which keeps the bundle CC BY 4.0 as in `CONTENT-LICENSE`), YouTube in any form (its terms forbid downloading, even for CC-BY videos), stock sites with their own terms, scraped gym or app videos, AI-generated video.
- Check the clip's own licence statement on its page (not only the site's default) and that it shows one person, full body, from the side or front, before running the pipeline. Whoever reviews the PR checks `source_url` shows the licence claimed.

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

`--out <file>` writes a one-exercise bundle instead of merging. The command validates before writing and exits non-zero when the clip is rejected (a hidden-landmark gap longer than `--max-gap` frames, too many bad frames, no repetition found, hips edge-on to the camera). A rejected clip means film it again. Other options: `--fps` (default 10), `--no-loop`, `--window`, `--order`, `--min-visibility`, `--licence` (CC-BY-4.0 default), `--author-url`, `--note`. The `tools` field is built from the landmarks file's `model` block (name and sha256, written by `run-model.py`): input with no model block, or from a model whose sha256 is not pinned, is refused. The validator also requires every non-fixture entry's `tools` to name a pinned model and its sha256, so a hand-edited value fails (`PINNED_MODELS` lives in `validate/exercise-motion.mjs`). `--fps` must be a whole number from 5 to 30. Only `--source synthetic_fixture` skips this, and it is allowed with `--out` only, never with `--merge`. When an entry would pass the 8,192-byte cap, the CLI steps the output fps down one at a time towards 5 and prints the fps it chose; if 5 fps still does not fit it fails and prints the longest loop that does. `npm run fixture:motion` rewrites the fixture; `npm run validate:exercise-motion` validates the bundle (`node validate/cli.mjs` runs it too).

## What the pipeline does and its parameters

1. Reads `mediapipe-world-landmarks-v1` JSON: `fps`, optional `indices` (which of the 33 landmarks are stored; 7, 8, 11 to 16 and 23 to 32 are needed (ears, shoulders, elbows, wrists, hips, knees, ankles, heels and foot-index toes)), and per frame `[x, y, z, visibility]` per landmark or `null` when no person was found.
2. A landmark is missing when visibility is below 0.5 or its frame is `null`. Bad frames at both ends are trimmed. Inside the clip a gap of up to 5 frames is filled by linear interpolation per landmark; a longer gap rejects the clip, and so do more than 25 % bad frames (counted after the bad frames at each end are trimmed). Nothing is invented across longer gaps.
3. Smoothing: Savitzky-Golay, window 7 frames (about 0.23 s at 30 fps), polynomial order 2, on every coordinate. It has no lag (a One Euro filter would add some offline), passes any quadratic unchanged, and at the ends the window slides inward. Use a smaller window for a lower frame rate.
4. Axes: MediaPipe world is x right, y down, z away from the camera; ours is x = the figure's left, y up, z forward. The whole clip is then turned about the vertical so the hip line lies on +x, so side and front clips give the same motion.
5. Loop trimming (default): the repetition ends at the earliest local minimum of the pose distance back to frame 0 that is within 25 % (plus 0.005) of the best match, at least 1.0 s after the start. No movement, or a pose that never returns, rejects the clip. `--no-loop` keeps the whole clip.
6. Resample to 10 fps (linear). A loop of N frames puts frame k at k/N of the period, so the step from the last frame back to the first is an ordinary step.
7. Retarget to our skeleton `pb19-v1` (head, neck, shoulders, elbows, wrists, spine_mid, hips, knees, ankles, heels, toes; heels and toes are MediaPipe landmarks 29 to 32): the joints are taken from the landmarks (head = ear midpoint, neck = shoulder midpoint, spine_mid = midpoint of hip centre and neck), then every bone is rebuilt from spine_mid with its fixed length from `BONES` in `validate/exercise-motion.mjs` and its measured direction. Only directions are used, so there is no separate size scale: the figure is 1.0 tall whoever was filmed, and bone lengths are constant in every frame (the validator allows 3 % for rounding).
8. Place the figure: units are body heights (about 1.0 tall). MediaPipe's origin is the hip centre of every frame, so the body's place in the world has to come from the feet: in each frame the lowest of all 19 joints is put on y = 0 (usually a heel or toe; for a lying move such as Dead Bug it is the back or head, so the body rests on the floor instead of sinking below it) and the ankle midpoint on x = z = 0. A heel raise keeps its height (the toe stays down); a jump cannot be recovered, because no flight phase exists in hip-centred input. The validator checks that the clip's lowest point is within 0.01 of y = 0. (A per-clip floor and anchor would leave a squat's hips at one height and its feet floating, because in hip-centred input the feet rise as the hips drop; we do not use it.) Values are rounded to 3 decimals.

Not done yet (later slices): joint limits, hand pinning to equipment, a preview page. These are the reasons the coach checks every loop.

## Format and size

See `tools/validate/schemas/exercise-motion.schema.json` and `tools/validate/exercise-motion.mjs`. A frame is 57 numbers (19 joints in the schema's order, x y z). Each entry is capped at 8,192 bytes; at 3 decimals that is about 22 frames, so about 2.2 s at 10 fps, or 4.4 s at 5 fps (the CLI steps the fps down to fit). The app player interpolates between frames, so a low fps is fine. The fixture entry is 6.9 KB for 20 frames.

- One clip per exercise goes into an entry, the side clip by default. The front clip is for checking only, and `clip_id` records which clip was used.
- The format keeps true proportions of the skeleton table. The app player (the next slice) rescales to the v1.1 rig's segment lengths, so the motion and the v1.1 figures look the same.

## From output to content and coach review

1. Run `cli.mjs --merge ../content/exercise-motion.json` for the exercise. Keys are kept sorted and the file is written one frame per line, so the PR diff shows the new entry only.
2. In `content/`, `node validate/cli.mjs` and `npm test` must pass. The validator needs source `own_filming` or `cc_licensed`, a licence on the allowlist, `clip_id`, a `release_id` (own filming only) or `source_url` and `retrieved` (CC clips only), and a real exercise name.
3. Regenerate `apps/mobile/src/content/bundled.json` (`node scripts/content-meta.mjs` in `apps/mobile`, full-history checkout).
4. Open a content PR. The coach reviews the motion (range of motion, tempo, joint alignment, no unnatural angles) once a preview exists, and signs off on the PR. The motion data is not wired into the app until the flag `EXPO_PUBLIC_EXERCISE_MOTION` slice lands.
