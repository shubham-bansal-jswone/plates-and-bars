import type { OcrCrop } from '../../modules/plate-label-scanner/types';
import { OcrError } from '../../modules/plate-label-scanner/errors';

/** The smallest crop side in pixels that is still worth reading (the same as the Android module). */
export const MIN_SIDE = 16;

export type PixelRect = { left: number; top: number; width: number; height: number };

/**
 * The pixel rectangle of a crop given as fractions of an image. No crop is the whole image; a box running past the edge is clipped.
 * Throws an `crop` [OcrError] for a box that is not finite, empty, outside the image or smaller than [MIN_SIDE] pixels.
 */
export function cropRect(crop: OcrCrop | undefined, width: number, height: number): PixelRect {
  const c = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const finite = [c.x, c.y, c.width, c.height].every((v) => typeof v === 'number' && Number.isFinite(v));
  if (!finite || c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x >= 1 || c.y >= 1) throw new OcrError('crop');
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  const left = clamp(c.x * width, width);
  const top = clamp(c.y * height, height);
  const right = clamp((c.x + c.width) * width, width);
  const bottom = clamp((c.y + c.height) * height, height);
  if (right - left < MIN_SIDE || bottom - top < MIN_SIDE) throw new OcrError('crop');
  return { left, top, width: right - left, height: bottom - top };
}
