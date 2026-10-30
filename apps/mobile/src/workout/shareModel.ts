import { formatWeight, fromKg, groupLabels, sessionVolume, type WeightUnit } from '@plate-and-bar/core';
import { fmt, shortDate, weekdayLong } from '../format';
import type { ExState, Row } from './model';

const n = (s: string): number => Number(s) || 0;
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** The heaviest ticked set (then the most reps); display only. */
export function bestSet(sets: readonly Row[]): Row | null {
  let best: Row | null = null;
  for (const s of sets) if (s.done && (!best || n(s.w) > n(best.w) || (n(s.w) === n(best.w) && n(s.r) > n(best.r)))) best = s;
  return best;
}

/**
 * Layout budget of the picture, in logical px (captured at 3x: 1080x1350, 4:5). The card and the web canvas both draw from
 * these, so what is promised here fits: padding, header, stats band, the exercise rows and the "+N more" line.
 */
export const CARD_W = 360;
export const CARD_H = 450;
export const CARD_PAD = 20;
export const HEADER_H = 75;
export const STATS_H = 70;
export const ROW_H = 32;
export const MORE_H = 21;
/** Exercise rows on the card; the rest are counted in "+N more" so the picture keeps its fixed size. */
export const CARD_MAX_ROWS = Math.floor((CARD_H - 2 * CARD_PAD - HEADER_H - STATS_H - MORE_H) / ROW_H);

/** The exercise name as drawn on the picture: the superset letter first when grouped. */
export const rowName = (r: { name: string; label?: string }): string => (r.label ? `${r.label}. ${r.name}` : r.name);

const compact = (x: number): string => (Math.abs(x) >= 10000 ? `${r1(x / 1000)}k` : fmt(x));

export interface ShareCardModel {
  title: string;
  dateLabel: string;
  /** Full figures and labels, as the completion panel shows them. */
  stats: { label: string; value: string }[];
  /** The same stats short enough for the card's four narrow boxes: "Volume kg", "12.4k". */
  cardStats: { label: string; value: string }[];
  /** Best set of every exercise, in order (the panel shows all; the card only the first CARD_MAX_ROWS). */
  bests: string[];
  rows: { name: string; best: string; pr: boolean; /** Superset letter, only on a grouped exercise. */ label?: string }[];
  more: number;
}

/**
 * What the shared picture says, and nothing else: the day, sets, volume (or reps), exercises, cardio minutes, each exercise's
 * best set and personal records. Built only from the ticked sets, so it cannot carry body weight, health answers, how a set
 * felt, calories (they depend on body weight), photos or any identifier.
 */
export function buildShareCard(p: { date: string; exs: readonly ExState[]; cardio: number | null; /** Lifts that are a personal best on `date`, from core's `personalRecords` / `isPrToday` (never `pbToast`). */ prs?: ReadonlySet<string>; unit?: WeightUnit; /** Superset letter per exercise; default: from the exercises' `group` (core's `groupLabels`). */ labels?: readonly (string | null | undefined)[] }): ShareCardModel {
  const unit = p.unit ?? 'kg';
  const sets = p.exs.flatMap((e) => e.sets);
  const done = sets.filter((s) => s.done).length;
  const vol = sessionVolume(p.exs);
  const reps = sets.reduce((t, s) => t + n(s.r), 0);
  const stats = [
    { label: 'Sets', value: `${done}/${sets.length}` },
    vol > 0 ? { label: `Volume (${unit})`, value: fmt(fromKg(vol, unit)) } : { label: 'Reps', value: fmt(reps) },
    { label: 'Exercises', value: String(p.exs.length) },
    ...(p.cardio ? [{ label: 'Cardio (min)', value: fmt(p.cardio) }] : []),
  ];
  const cardStats = [
    { label: 'Sets', value: `${done}/${sets.length}` },
    vol > 0 ? { label: `Volume ${unit}`, value: compact(fromKg(vol, unit)) } : { label: 'Reps', value: compact(reps) },
    { label: 'Exercises', value: String(p.exs.length) },
    ...(p.cardio ? [{ label: 'Cardio min', value: compact(p.cardio) }] : []),
  ];
  const labels = p.labels ?? groupLabels(p.exs.map((e) => ({ name: e.name, sets: e.sets.length, group: e.group })));
  const rows = p.exs.map((e, i) => {
    const b = bestSet(e.sets);
    const label = labels[i];
    return { name: e.name, ...(label ? { label } : {}), best: !b ? '' : n(b.w) ? `${formatWeight(n(b.w), unit)} x ${n(b.r)}` : `${n(b.r)} reps`, pr: p.prs?.has(e.name) ?? false };
  });
  const title = `${weekdayLong(p.date)} workout`;
  const dateLabel = `${shortDate(p.date)} ${p.date.slice(0, 4)}`;
  return {
    title,
    dateLabel,
    stats,
    cardStats,
    bests: rows.map((r) => r.best),
    rows: rows.slice(0, CARD_MAX_ROWS),
    more: Math.max(0, rows.length - CARD_MAX_ROWS),
  };
}
