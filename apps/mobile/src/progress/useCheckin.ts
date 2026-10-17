import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addDays, addKcal, habits, mondayOf, nextAdaptive, RAPID_LOSS_KCAL, rapidLoss, SPLITS, stalledList, weeklyCheckin, type AdaptiveState, type LiftRecord, type ProgressDay, type SessionLog, type WeekPlan } from '@plate-and-bar/core';
import { loadDayNote, loadLogs } from '../db/food';
import { loadLifts, loadSessionLog, loadSets, loadWorkout, type WorkoutDb } from '../db/workouts';
import { freshRead } from '../state/freshRead';
import { dayQueue, dayWrites } from '../workout/dayQueue';
import { localDate } from '../setup/logic';
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
/** Decline and mute key of the rapid-loss card (prototype type `kcal-up`). */
const RAPID_TYPE = 'kcal-up';
const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Options {
  db: WorkoutDb;
  date: string;
  weights: readonly Weight[];
  now: () => Date;
  notify: (msg: string) => void;
  /** Changes when sync stored pulled records: the days are read again (after queued workout writes). */
  reloadKey?: number;
}

/**
 * Weekly check-in, real burn and habits for the week ending on `date`: the last 21 days are read from SQLite and
 * every number comes from core. The suggested actions only change local settings and targets.
 */
export function useCheckin({ db, date, weights, now, notify, reloadKey = 0 }: Options) {
  const { profile, setProfile } = useProfile();
  const { settings, update, ready: settingsReady, loadFailed } = useSettings();
  // Settings feed the suggestion and are written back, so nothing runs until the stored record has loaded.
  const usable = settingsReady && !loadFailed;
  const [days, setDays] = useState<ProgressDay[] | null>(null);
  const [lifts, setLifts] = useState<Record<string, LiftRecord>>({});
  const [sessions, setSessions] = useState<SessionLog>({});
  // Tab screens stay mounted, so the days are read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));

  useEffect(() => {
    let live = true;
    (async () => {
      // The workout sets come from the Workout tab's writes, so the read waits for that queue too. Food logs and day
      // notes are saved through their own hooks' queues and are not awaited: a just-saved value can show one focus late.
      await freshRead(
        { queue: dayQueue, writes: dayWrites },
        async () => {
          const keys = Array.from({ length: DAYS }, (_, i) => addDays(date, i - DAYS + 1));
          const read = await Promise.all(
            keys.map(async (d): Promise<ProgressDay> => {
              const [logs, note, workout, sets] = await Promise.all([loadLogs(db, d), loadDayNote(db, d), loadWorkout(db, d), loadSets(db, d)]);
              const w = workout && !workout.deleted_at ? workout : null;
              return { date: d, logs, complete: note?.complete, steps: note?.steps, sleep: note?.sleep, cardioMin: w?.cardio_min, trained: !!w && sets.some((s) => s.kind === 'work' && s.done && !s.deleted_at) };
            }),
          );
          const [l, s] = await Promise.all([loadLifts(db), loadSessionLog(db)]);
          return { read, l, s };
        },
        () => live,
        ({ read, l, s }) => {
          setDays(read);
          setLifts(l);
          setSessions(s);
        },
      );
    })().catch(() => {
      if (live) notify('Couldn’t read your saved progress.');
    });
    return () => {
      live = false;
    };
  }, [db, date, shown, notify, reloadKey]);

  const A = settings.adjustments as Adjustments;
  // The real date, so a day that is today is complete only when ticked (core #150), as in useProgress.
  const today = localDate(now());
  const adaptive = settings.adaptive as AdaptiveState;
  const checkin = useMemo(
    () =>
      profile && days && usable
        ? weeklyCheckin({ date, days, weighIns: weights, lifts, kcal: profile.targets.kcal, protein: profile.targets.protein_g, profile, adaptive, today, weekPlan: A.weekPlan, dismissed: A.dismissed, muted: A.muted })
        : null,
    [profile, days, usable, date, today, weights, lifts, adaptive, A.weekPlan, A.dismissed, A.muted],
  );
  // The "Weight is dropping fast" card (prototype `calorieCard`): needs the profile, since "Add 150 kcal" changes its targets.
  const rapid = useMemo(() => {
    if (!profile || !days || !usable) return null;
    const r = rapidLoss(weights, date, stalledList(lifts, date).length);
    return r && !A.muted?.[RAPID_TYPE] && !A.dismissed?.[r.key] ? r : null;
  }, [profile, days, usable, date, weights, lifts, A.muted, A.dismissed]);
  const habit = useMemo(() => (profile && days ? habits(date, sessions, profile, days) : null), [profile, days, date, sessions]);

  // As the prototype does on showing the check-in: remember a ready burn estimate, and that this week's was seen.
  const burn = checkin?.burn.ready ? checkin.burn.burn : null;
  useEffect(() => {
    if (burn === null || !usable) return;
    const next = nextAdaptive(adaptive, date, burn);
    if (next.value !== adaptive.value || next.week !== adaptive.week || next.prev !== adaptive.prev) update({ adaptive: { ...next } });
  }, [burn, usable, adaptive, date, update]);
  // Food's check-in banner goes once Progress has been shown this week. As the prototype's `renderCheckin` does, that is
  // marked whenever the check-in is shown, even if the 21-day read failed or there is no profile (the banner must not stay all day).
  const thisMonday = mondayOf(today);
  const seen = usable && settings.checkin_seen !== thisMonday;
  useEffect(() => {
    if (seen) update({ checkin_seen: thisMonday });
  }, [seen, thisMonday, update]);

  // Each change builds on the provider's latest record, so two quick taps both count.
  const dismiss = (key: string, extra: (a: Adjustments) => Partial<Adjustments> = () => ({})) =>
    update((s) => {
      const a = s.adjustments as Adjustments;
      return { adjustments: { ...s.adjustments, ...extra(a), dismissed: { ...a.dismissed, [key]: true } } };
    });

  return {
    checkin,
    habit,
    /** The last 21 days as read for the check-in, null until loaded; the "Seven days" block uses the last 7. */
    days,
    ready: days !== null && usable,
    /** The stored settings could not be read: the card shows a message and no actions. */
    settingsFailed: loadFailed,
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
      dismiss(checkin.key, () => ({ weekPlan: { start: addDays(mondayOf(date), 7), list: SPLITS[4].list } }));
      notify('Next week: 4-day plan');
    },
    /** "Not now" / "Keep current targets": counts a decline; three stop the suggestion. */
    decline: () => {
      if (!checkin) return;
      dismiss(checkin.key, (a) => ({ declines: { ...a.declines, checkin: (a.declines?.checkin ?? 0) + 1 } }));
    },
    declines: A.declines?.checkin ?? 0,
    rapid,
    rapidDeclines: A.declines?.[RAPID_TYPE] ?? 0,
    /** "Add 150 kcal": calories and carbs on the profile (core `addKcal`), then the card is dismissed for the week. */
    addCalories: async () => {
      if (!profile || !rapid || !usable) return;
      const t = addKcal({ kcal: profile.targets.kcal, carbs: profile.targets.carbs_g }, RAPID_LOSS_KCAL);
      try {
        await setProfile({ ...profile, targets: { ...profile.targets, kcal: t.kcal, carbs_g: t.carbs }, updated_at: stamp(now()) });
        dismiss(rapid.key);
        notify(`Calories raised to ${t.kcal.toLocaleString('en-IN')}`);
      } catch {
        notify('Couldn’t save that. Try again.');
      }
    },
    /** "Not now" on the rapid-loss card: dismissed for the week, a decline counted. */
    declineRapid: () => {
      if (!rapid) return;
      dismiss(rapid.key, (a) => ({ declines: { ...a.declines, [RAPID_TYPE]: (a.declines?.[RAPID_TYPE] ?? 0) + 1 } }));
    },
    stopSuggestingRapid: () => {
      update((st) => ({ adjustments: { ...st.adjustments, muted: { ...(st.adjustments as Adjustments).muted, [RAPID_TYPE]: true } } }));
      notify('Got it, no more of these');
    },
    stopSuggesting: () => {
      update((st) => ({ adjustments: { ...st.adjustments, muted: { ...(st.adjustments as Adjustments).muted, checkin: true } } }));
      notify('Got it, no more of these');
    },
  };
}
