import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import { dark as c } from '../theme/tokens';
import type { SaveResult } from '../account/saveFile';
import { CARD_PAD, HEADER_H, ROW_H, STATS_H, rowName, type ShareCardModel } from './shareModel';

const S = 3; // 360x450 logical px to 1080x1350
const FAMILY: Record<number, string> = { 400: 'Inter_400Regular', 600: 'Inter_600SemiBold', 700: 'Inter_700Bold', 800: 'Inter_800ExtraBold' };
const FALLBACK = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
const face = (w: number, px: number): string => `${px}px ${FAMILY[w] ?? FAMILY[400]}, ${FALLBACK}`;

/**
 * Web (native uses shareImage.native.ts, which captures a view): draws the same card on a 1080x1350 canvas in the app's
 * Inter faces and downloads the PNG. No view capture library is bundled for web (it would need html2canvas), and nothing is
 * uploaded. Every text is measured and shrunk, then cut with an ellipsis, so it stays inside its box.
 */
export async function shareWorkoutImage(model: ShareCardModel, _card?: RefObject<ComponentRef<typeof View> | null>): Promise<SaveResult> {
  const canvas = document.createElement('canvas');
  canvas.width = 360 * S;
  canvas.height = 450 * S;
  const g = canvas.getContext('2d');
  if (!g) return 'unavailable';
  // The faces load with the app; make sure they are ready before measuring and drawing.
  const fonts = (document as { fonts?: { load?: (f: string) => Promise<unknown>; ready?: Promise<unknown> } }).fonts;
  try {
    await Promise.all([400, 600, 700, 800].map((w) => fonts?.load?.(face(w, 16))));
    await fonts?.ready;
  } catch {
    // the fallback stack still draws
  }
  g.fillStyle = c.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.textBaseline = 'middle';
  /** Draws `s` inside `maxW`: shrinks to 70% of `px`, then cuts with an ellipsis. `y` is the middle of the line. */
  const text = (s: string, x: number, y: number, maxW: number, color: string, w: number, px: number, align: CanvasTextAlign = 'left') => {
    g.fillStyle = color;
    g.textAlign = align;
    let size = px * S;
    g.font = face(w, size);
    while (g.measureText(s).width > maxW && size > px * S * 0.7) g.font = face(w, (size -= 1));
    let out = s;
    while (out.length > 1 && g.measureText(out).width > maxW) out = `${out.slice(0, -2).trimEnd()}…`;
    g.fillText(out, x, y);
  };
  const pad = CARD_PAD * S;
  const inner = canvas.width - 2 * pad;
  text('PLATE AND BAR', pad, pad + 9 * S, inner, c.brand, 600, 12);
  text(model.title, pad, pad + 32 * S, inner, c.ink, 800, 22);
  text(model.dateLabel, pad, pad + 56 * S, inner, c.body, 400, 14);
  const top = pad + HEADER_H * S;
  const gap = 8 * S;
  const bw = (inner - gap * (model.cardStats.length - 1)) / model.cardStats.length;
  model.cardStats.forEach((st, i) => {
    const x = pad + i * (bw + gap);
    g.fillStyle = c.surface;
    g.beginPath();
    g.roundRect?.(x, top, bw, (STATS_H - 16) * S, 14 * S);
    if (!g.roundRect) g.rect(x, top, bw, (STATS_H - 16) * S);
    g.fill();
    text(st.value, x + 6 * S, top + 18 * S, bw - 12 * S, c.ink, 700, 17);
    text(st.label, x + 6 * S, top + 38 * S, bw - 12 * S, c.muted, 600, 12);
  });
  const rows = top + STATS_H * S;
  model.rows.forEach((r, i) => {
    const y = rows + i * ROW_H * S;
    g.fillStyle = c.line;
    g.fillRect(pad, y, inner, S);
    g.textAlign = 'right';
    g.font = face(600, 16 * S);
    const bestW = Math.min(g.measureText(r.best).width, inner / 2);
    const prW = r.pr ? 40 * S : 0;
    text(r.best, pad + inner, y + (ROW_H / 2) * S, bestW, c.ink, 600, 16, 'right');
    if (r.pr) {
      const px = pad + inner - bestW - 8 * S - prW;
      g.fillStyle = c.brand;
      g.beginPath();
      if (g.roundRect) g.roundRect(px, y + 7 * S, prW, 18 * S, 9 * S);
      else g.rect(px, y + 7 * S, prW, 18 * S);
      g.fill();
      text('PR', px + prW / 2, y + (ROW_H / 2) * S, prW - 8 * S, c.onBrand, 800, 12, 'center');
    }
    text(rowName(r), pad, y + (ROW_H / 2) * S, inner - bestW - prW - 16 * S, c.ink, 600, 16);
  });
  if (model.more) text(`+${model.more} more`, pad, rows + model.rows.length * ROW_H * S + 10 * S, inner, c.muted, 400, 14);
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
