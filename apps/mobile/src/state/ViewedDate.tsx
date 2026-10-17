import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { addDays } from '@plate-and-bar/core';
import { localDate } from '../setup/logic';

const parse = (d: string): Date => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, day);
};

/** The prototype's header label: Today, Yesterday, else the short weekday. */
export const dateLabel = (date: string, today: string): string =>
  date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : parse(date).toLocaleDateString('en-IN', { weekday: 'short' });
/** The line under it: "Saturday, 17 Oct". */
export const dateSub = (date: string): string => parse(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

interface Shared {
  picked: string | null;
  setPicked: (d: string | null) => void;
}
const Ctx = createContext<Shared | null>(null);

/** One viewed day for the Food, Workout and Progress tabs, as the prototype's `S.date` is shared by every tab. */
export function ViewedDateProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<string | null>(null);
  const value = useMemo(() => ({ picked, setPicked }), [picked]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface ViewedDate {
  /** The day shown (YYYY-MM-DD). */
  date: string;
  /** The real today: use it for everything that is for today only, and for every dismissal. */
  today: string;
  isToday: boolean;
  prev: () => void;
  /** Does nothing at today. */
  next: () => void;
}

/**
 * The day a tab shows. `null` means "today", so a screen left on today follows midnight (prototype FOLLOW_TODAY);
 * going back to today clears the pick. Without a provider (a screen on its own) the day is local to the screen.
 */
export function useViewedDate(now: () => Date): ViewedDate {
  const shared = useContext(Ctx);
  const local = useState<string | null>(null);
  const picked = shared ? shared.picked : local[0];
  const setPicked = shared ? shared.setPicked : local[1];
  const today = localDate(now());
  const date = picked ?? today;
  const go = useCallback(
    (n: number) => {
      const to = addDays(date, n);
      if (to > today) return;
      setPicked(to === today ? null : to);
      // Announced here, not from the bar, so it is said once per change whatever the screen shows while the day loads.
      AccessibilityInfo.announceForAccessibility(`${dateLabel(to, today)}, ${dateSub(to)}`);
    },
    [date, today, setPicked],
  );
  const prev = useCallback(() => go(-1), [go]);
  const next = useCallback(() => go(1), [go]);
  return { date, today, isToday: date === today, prev, next };
}
