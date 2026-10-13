import { useCallback, useEffect, useState } from 'react';
import { daysBetween } from '@plate-and-bar/core';
import type { PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { completePhotoWipe } from '../sync/guard';
import { PHOTOS_GRID, PHOTOS_STALE_DAYS } from './copy';
import { POSES, deletePhoto, getPhoto, photoDates, putPhoto, type Pose } from './vault';

export type CompareMode = 'side' | 'slider';
export interface Thumb {
  date: string;
  src: string | null;
}
export interface Photos {
  /** False until the vault has been read; `failed` when it could not be (the screen offers a retry, never a check-in). */
  ready: boolean;
  failed: boolean;
  dates: string[];
  thumbs: Thumb[];
  /** Days since the last check-in when that is at least the stale limit, else null. */
  staleDays: number | null;
  hasToday: boolean;
  a: string | null;
  b: string | null;
  pose: Pose;
  mode: CompareMode;
  /** The compared pair as data URIs; null when fewer than two dates. A side is null when that date has no such pose. */
  pair: { a: string | null; b: string | null } | null;
  today: Record<Pose, string | null>;
  setA(d: string): void;
  setB(d: string): void;
  setPose(p: Pose): void;
  setMode(m: CompareMode): void;
  save(pose: Pose, jpegBase64: string): Promise<void>;
  remove(date: string): Promise<void>;
  retry(): void;
}

const uri = (b64: string | null) => (b64 ? `data:image/jpeg;base64,${b64}` : null);
const firstPose = async (date: string) => {
  for (const p of POSES) {
    const b = await getPhoto(date, p);
    if (b) return b;
  }
  return null;
};
/** The app database can run the owed photo wipe; test doubles without transactions skip it. */
const canWipe = (db: StoreDb): db is StoreDb & PullDb => typeof (db as Partial<PullDb>).withExclusiveTransactionAsync === 'function';

/** Progress photos for the Progress tab (prototype `renderPhotos`). An owed vault wipe is finished before anything is read. */
export function usePhotos({ db, date }: { db: StoreDb; date: string }): Photos {
  const [load, setLoad] = useState(0);
  const [state, setState] = useState<{ ready: boolean; failed: boolean; dates: string[]; thumbs: Thumb[]; today: Record<Pose, string | null> }>({
    ready: false,
    failed: false,
    dates: [],
    thumbs: [],
    today: { front: null, side: null, back: null },
  });
  const [sel, setSel] = useState<{ a: string | null; b: string | null; pose: Pose; mode: CompareMode }>({ a: null, b: null, pose: 'front', mode: 'side' });
  const [pair, setPair] = useState<{ key: string; a: string | null; b: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (canWipe(db)) await completePhotoWipe(db);
      const dates = await photoDates();
      const thumbs = await Promise.all(dates.slice().reverse().slice(0, PHOTOS_GRID).map(async (d) => ({ date: d, src: uri(await firstPose(d)) })));
      const today = Object.fromEntries(await Promise.all(POSES.map(async (p) => [p, uri(await getPhoto(date, p))] as const))) as Record<Pose, string | null>;
      if (live) setState({ ready: true, failed: false, dates, thumbs, today });
    })().catch(() => live && setState((s) => ({ ...s, ready: true, failed: true })));
    return () => {
      live = false;
    };
  }, [db, date, load]);

  const { dates } = state;
  const last = dates[dates.length - 1];
  const a = sel.a && dates.includes(sel.a) ? sel.a : (dates[0] ?? null);
  const b = sel.b && dates.includes(sel.b) ? sel.b : (last ?? null);

  // The loaded pair is keyed by what it shows, so a pair for other dates or another pose is never returned.
  const pairKey = dates.length >= 2 && a && b ? `${a}|${b}|${sel.pose}|${load}` : null;
  useEffect(() => {
    if (!pairKey || !a || !b) return;
    let live = true;
    (async () => {
      const [pa, pb] = await Promise.all([getPhoto(a, sel.pose), getPhoto(b, sel.pose)]);
      if (live) setPair({ key: pairKey, a: uri(pa), b: uri(pb) });
    })().catch(() => live && setPair({ key: pairKey, a: null, b: null }));
    return () => {
      live = false;
    };
  }, [pairKey, a, b, sel.pose]);

  const reload = useCallback(() => setLoad((n) => n + 1), []);
  const save = useCallback(
    async (pose: Pose, jpegBase64: string) => {
      await putPhoto(date, pose, jpegBase64);
      reload();
    },
    [date, reload],
  );
  const remove = useCallback(
    async (d: string) => {
      for (const p of POSES) await deletePhoto(d, p);
      reload();
    },
    [reload],
  );

  const since = last ? daysBetween(last, date) : 0;
  return {
    ...state,
    staleDays: last && since >= PHOTOS_STALE_DAYS ? since : null,
    hasToday: dates.includes(date),
    a,
    b,
    pose: sel.pose,
    mode: sel.mode,
    pair: pair && pair.key === pairKey ? { a: pair.a, b: pair.b } : null,
    setA: (d) => setSel((s) => ({ ...s, a: d })),
    setB: (d) => setSel((s) => ({ ...s, b: d })),
    setPose: (p) => setSel((s) => ({ ...s, pose: p })),
    setMode: (m) => setSel((s) => ({ ...s, mode: m })),
    save,
    remove,
    retry: reload,
  };
}
