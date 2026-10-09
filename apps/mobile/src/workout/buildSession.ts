import {
  applyFocus,
  lastFor,
  mapForWhere,
  resolveSessionWithLost,
  sessionMods,
  type SessionMods,
  sessionSets,
  shortSession,
  TEMPLATES,
  trimSession,
  type LiftRecord,
  type Exclusion,
  type Swap,
  type SessionLog,
  type Checkin,
  type Where,
} from '@plate-and-bar/core';
import type { Profile } from '../setup/types';
import { catalog } from './catalog';


export interface BuildInput {
  template: string;
  date: string;
  profile: Profile;
  where: Where;
  sessions: SessionLog;
  lifts: Readonly<Record<string, LiftRecord>>;
  ciChoice: 'light' | 'swap' | 'orig' | null;
  checkin: Checkin;
  /** Focus muscles (contract `Settings.focus`); empty until the app stores settings. */
  focus: readonly string[];
  /** Saved exercise rules and swaps (contract `Exclusion` and `Swap` records). */
  exclusions: readonly Exclusion[];
  swaps: readonly Swap[];
}

export interface BuiltSession {
  /** Exercises in session order, with their working-set counts. */
  exercises: { name: string; sets: number; bridge: boolean }[];
  mods: SessionMods;
  /** Names the template has that this session leaves out (they rotate in on other days). */
  left: string[];
  /** The exercises `applyFocus` added, for the focus badge. */
  focus: string[];
  /** Excluded exercises left out with no replacement: the preview says the muscles get fewer sets. */
  lost: string[];
}

/**
 * Today's session for a template, in the prototype's `buildSession` order: home mapping, swaps and
 * exclusions, trim to the session length, focus, the check-in short cut, then set counts. Every step is core's.
 * Recovery weeks are a setting the app does not store yet.
 */
export function buildSession(i: BuildInput): BuiltSession {
  const names = mapForWhere([...(TEMPLATES[i.template] ?? [])], i.where, catalog);
  const resolve = { exclusions: i.exclusions, swaps: i.swaps, lifts: i.lifts, date: i.date };
  const { items: all, lost } = resolveSessionWithLost(names, i.where, resolve, catalog);
  const state = { profile: i.profile, sessions: i.sessions };
  let items = applyFocus(trimSession(all, i.template, state), i.template, i.where, { profile: i.profile, lifts: i.lifts, focus: i.focus }, catalog);
  items = shortSession(items, i.checkin.time);
  // Recovery week and re-entry are settings the app does not store yet. TODO(recovery issue): pass them here.
  const { setsLight, mods } = sessionMods({ date: i.date, ciChoice: i.ciChoice, time: i.checkin.time, where: i.where, profile: i.profile, deload: null, reentry: null });
  const sets = sessionSets(items, {
    profile: i.profile,
    date: i.date,
    focus: i.focus,
    tags: catalog.tags,
    lastSets: (n) => lastFor(n, i.lifts, i.date)?.sets.length,
    light: setsLight,
  });
  const kept = new Set(items.map((x) => x.name));
  return {
    exercises: sets.map((e) => ({ name: e.name, sets: e.sets, bridge: !!e.bridge })),
    mods,
    left: all.filter((x) => !kept.has(x.name)).map((x) => x.name),
    focus: items.filter((x) => x.focus).map((x) => x.name),
    lost,
  };
}
