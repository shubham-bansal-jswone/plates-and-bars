import { createElement, type ComponentType, type ReactElement } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';

/**
 * One camera frame's result from the native side (#947): MoveNet's 17 keypoints as x, y, score for each point (51 numbers, x and y as
 * 0..1 of the upright frame), the frame's pixel size and a timestamp in milliseconds (elapsed realtime). The frame itself never leaves
 * the native view.
 */
export type PoseFrame = { t: number; width: number; height: number; keypoints: number[] };

export type PoseEvent = NativeSyntheticEvent<PoseFrame>;
export type ReadyEvent = NativeSyntheticEvent<{ front: boolean }>;
/** message: no_activity, no_camera, camera_failed, model_failed, model_hash_mismatch, inference_failed (or the camera's own text). */
export type ErrorEvent = NativeSyntheticEvent<{ message: string }>;

export type PoseViewProps = {
  style?: StyleProp<ViewStyle>;
  /** false pauses tracking (the preview keeps running). */
  active?: boolean;
  onPose: (e: PoseEvent) => void;
  onReady?: (e: ReadyEvent) => void;
  onError?: (e: ErrorEvent) => void;
};

type Native = { verifyModel(): Promise<{ sha256: string; bytes: number }> };

let view: ComponentType<PoseViewProps> | null = null;
let native: Native | null = null;

/** The native camera view (CameraX plus MoveNet on LiteRT). Android only; looked up on first render so other platforms and tests never load it. */
export function PoseCameraView(props: PoseViewProps): ReactElement {
  view ??= requireNativeView<PoseViewProps>('PlatePose');
  return createElement(view, props);
}

/** Copies the bundled model to private storage if needed and returns the sha256 of the file the camera view will load. */
export function verifyModel(): Promise<{ sha256: string; bytes: number }> {
  native ??= requireNativeModule<Native>('PlatePose');
  return native.verifyModel();
}
