#!/usr/bin/env python3
"""Optional step: run MediaPipe Pose Landmarker on a video and save the 3D world landmarks as JSON for pipeline.mjs.

Runs on CPU, offline, once the model file is on disk. Never run in CI. The video is read locally and never leaves the machine;
only landmark numbers are written.

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python run-model.py clip.mp4 pose_landmarker_full.task landmarks.json
"""
import argparse
import hashlib
import json
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# sha256 of the model bundles as served on 2026-10-19 from
# https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_<variant>/float16/latest/pose_landmarker_<variant>.task
KNOWN_MODELS = {
    "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad": "pose_landmarker_full (float16)",
    "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b": "pose_landmarker_heavy (float16)",
}
INDICES = [7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]  # the landmarks pipeline.mjs uses


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("model", help="pose_landmarker_full.task or pose_landmarker_heavy.task")
    ap.add_argument("out")
    ap.add_argument("--allow-unpinned", action="store_true", help="accept a model file whose sha256 is not listed above")
    args = ap.parse_args()

    with open(args.model, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest not in KNOWN_MODELS and not args.allow_unpinned:
        print(f"model sha256 {digest} is not one we have checked the licence of; stop, or pass --allow-unpinned", file=sys.stderr)
        return 1

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        print("could not read the frame rate of the video", file=sys.stderr)
        return 1
    frames = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        n = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            result = landmarker.detect_for_video(image, int(round(n * 1000.0 / fps)))
            if result.pose_world_landmarks:
                lm = result.pose_world_landmarks[0]
                frames.append([[round(lm[i].x, 4), round(lm[i].y, 4), round(lm[i].z, 4), round(lm[i].visibility or 0.0, 3)] for i in INDICES])
            else:
                frames.append(None)  # no person found: pipeline.mjs treats it as a gap
            n += 1
    cap.release()
    out = {
        "format": "mediapipe-world-landmarks-v1",
        "fps": round(fps, 3),
        "indices": INDICES,
        "model": {"name": KNOWN_MODELS.get(digest, "unpinned"), "sha256": digest, "mediapipe": mp.__version__},
        "frames": frames,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(frames)} frames at {fps:.2f} fps, {sum(1 for x in frames if x is None)} without a person -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
