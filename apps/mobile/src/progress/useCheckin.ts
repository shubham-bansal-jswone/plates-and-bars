import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addDays, habits, mondayOf, nextAdaptive, SPLITS, weeklyCheckin, type AdaptiveState, type LiftRecord, type ProgressDay, type SessionLog, type WeekPlan } from '@plate-and-bar/core';
import { loadDayNote, loadLogs } from '../db/food';
import { loadLifts, loadSessionLog, loadSets, loadWorkout, type WorkoutDb } from '../db/workouts';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import type { Weight } from './types';

/** How many days the check-in reads (core: at least 21 ending on the day shown). */
const DAYS = 21;

interface Adjustments {
  weekPlan?: WeekPlan;
  dismissed?: Record<string, boolean>;
  muted?: Record<string, boolean>;
  declines?: Record<string, number>;
}
const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Options {
  db: WorkoutDb;
  date: string;
  weights: readonly Weight[];
  now: () => Date;
  notify: (msg: string) => void;
}

/**
 * Weekly check-in, real burn and habits for the week ending on `date`: the last 21 days are read from SQLite and
 * every number comes from core. The suggested actions only change local settings and targets.
 */
export function useCheckin({ db, date, weights, now, notify }: Options) {
  const { profile, setProfile } = useProfile();
  const { settings, update } = useSettings();
  const [days, setDays] = useState<ProgressDay[] | null>(null);
  const [lifts, setLifts] = useState<Record<string, LiftRecord>>({});
  const [sessions, setSessions] = useState<SessionLog>({});
  // Tab screens stay mounted, so the days are read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));

  useEffect(() => {
    let live = true;
    (async () => {
      const keys = Array.from({ length: DAYS }, (_, i) => addDays(date, i - DAYS + 1));
      const read = await Promise.all(
        keys.map(async (d): Promise<ProgressDay> => {
          const [logs, note, workout, sets] = await Promise.all([loadLogs(db, d), loadDayNote(db, d), loadWorkout(db, d), loadSets(db, d)]);
          const w = workout && !workout.deleted_at ? workout : null;
          return { date: d, logs, complete: note?.complete, steps: note?.steps, sleep: note?.sleep, cardioMin: w?.cardio_min, trained: !!w && sets.some((s) => s.kind === 'work' && s.done && !s.deleted_at) };
        }),
      );
      const [l, s] = await Promise.all([loadLifts(db), loadSessionLog(db)]);
      if (!live) return;
      setDays(read);
      setLifts(l);
      setSessions(s);
    })().catch(() => {
      if (live) notify('Couldn’t read your saved progress.');
    });
    return () => {
      live = false;
    };
  }, [db, date, shown, notify]);

  const A = settings.adjustments as Adjustments;
  const adaptive = settings.adaptive as AdaptiveState;
  const checkin = useMemo(
    () =>
      profile && days
        ? weeklyCheckin({ date, days, weighIns: weights, lifts, kcal: profile.targets.kcal, protein: profile.targets.protein_g, profile, adaptive, weekPlan: A.weekPlan, dismissed: A.dismissed, muted: A.muted })
        : null,
    [profile, days, date, weights, lifts, adaptive, A.weekPlan, A.dismissed, A.muted],
  );
  const habit = useMemo(() => (profile && days ? habits(date, sessions, profile, days) : null), [profile, days, date, sessions]);

  // As the prototype does on showing the check-in: remember a ready burn estimate, and that this week's was seen.
  const burn = checkin?.burn.ready ? checkin.burn.burn : null;
  useEffect(() => {
    if (burn === null) return;
    const next = nextAdaptive(adaptive, date, burn);
    if (next.value !== adaptive.value || next.week !== adaptive.week || next.prev !== adaptive.prev) update({ adaptive: { ...next } });
  }, [burn, adaptive, date, update]);
  const seen = !!checkin && settings.checkin_seen !== mondayOf(date);
  useEffect(() => {
    if (seen) update({ checkin_seen: mondayOf(date) });
  }, [seen, date, update]);

  const dismiss = (key: string, extra: Partial<Adjustments> = {}) => update({ adjustments: { ...settings.adjustments, ...extra, dismissed: { ...A.dismissed, [key]: true } } });

  return {
    checkin,
    habit,
    ready: days !== null,
    /** "Update my targets": the suggested kcal and macros go on the profile. */
    applyTargets: async () => {
      const s = checkin?.suggestion;
      if (!profile || !s || s.kind !== 'kcal') return;
      const t = s.target;
      try {
        await setProfile({ ...profile, targets: { kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat }, updated_at: stamp(now()) });
        dismiss(checkin.key);
        notify(`Targets updated: ${t.kcal.toLocaleString('en-IN')} kcal`);
      } catch {
        notify('Couldn’t save that. Try again.');
      }
    },
    /** "Use a 4-day plan next week". */
    shorterWeek: () => {
      if (!checkin) return;
      dismiss(checkin.key, { weekPlan: { start: addDays(mondayOf(date), 7), list: SPLITS[4].list } });
      notify('Next week: 4-day plan');
    },
    /** "Not now" / "Keep current targets": counts a decline; three stop the suggestion. */
    decline: () => {
      if (!checkin) return;
      dismiss(checkin.key, { declines: { ...A.declines, checkin: (A.declines?.checkin ?? 0) + 1 } });
    },
    declines: A.declines?.checkin ?? 0,
    stopSuggesting: () => {
      update({ adjustments: { ...settings.adjustments, muted: { ...A.muted, checkin: true } } });
      notify('Got it, no more of these');
    },
  };
}
