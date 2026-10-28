import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import { dark as c } from '../theme/tokens';
import type { SaveResult } from '../account/saveFile';
import type { ShareCardModel } from './shareModel';

/**
 * Web (native uses shareImage.native.ts, which captures a view): draws the same card on a 1080x1350 canvas and downloads
 * the PNG. No view capture library is bundled for web (it would need html2canvas), and nothing is uploaded.
 */
export async function shareWorkoutImage(model: ShareCardModel, _card?: RefObject<ComponentRef<typeof View> | null>): Promise<SaveResult> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const g = canvas.getContext('2d');
  if (!g) return 'unavailable';
  const font = (w: number, px: number) => `${w} ${px}px system-ui, sans-serif`;
  g.fillStyle = c.bg;
  g.fillRect(0, 0, 1080, 1350);
  g.textBaseline = 'top';
  const text = (s: string, x: number, y: number, color: string, f: string, align: CanvasTextAlign = 'left') => {
    g.fillStyle = color;
    g.font = f;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  text('PLATE AND BAR', 72, 72, c.brand, font(700, 36));
  text(model.title, 72, 130, c.ink, font(800, 90));
  text(model.dateLabel, 72, 236, c.body, font(400, 42));
  const w = (1080 - 144 - 36 * (model.stats.length - 1)) / model.stats.length;
  model.stats.forEach((s, i) => {
    const x = 72 + i * (w + 36);
    g.fillStyle = c.surface;
    g.fillRect(x, 330, w, 190);
    text(s.value, x + 30, 360, c.ink, font(800, 84));
    text(s.label, x + 30, 460, c.muted, font(600, 34));
  });
  model.rows.forEach((r, i) => {
    const y = 580 + i * 100;
    g.fillStyle = c.line;
    g.fillRect(72, y, 936, 3);
    text(r.name, 72, y + 24, c.ink, font(600, 44));
    text(r.best, 1008, y + 24, c.ink, font(600, 44), 'right');
    if (r.pr) text('PR', 760, y + 28, c.brand, font(800, 38), 'right');
  });
  if (model.more) text(`+${model.more} more`, 72, 580 + model.rows.length * 100 + 24, c.muted, font(400, 40));
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) return 'unavailable';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plate-and-bar-workout-summary.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
