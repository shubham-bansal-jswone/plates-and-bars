import {
  applyFocus,
  lastFor,
  mapForWhere,
  needsClearance,
  resolveSession,
  sessionSets,
  shortSession,
  TEMPLATES,
  trimSession,
  type LiftRecord,
  type SessionItem,
  type SessionLog,
  type Where,
} from '@plate-and-bar/core';
import type { Profile } from '../setup/types';
import { catalog } from './catalog';

export interface CheckIn {
  sleep?: string;
  sore?: string;
  energy?: string;
  time?: string;
}

export interface BuildInput {
  template: string;
  date: string;
  profile: Profile;
  where: Where;
  sessions: SessionLog;
  lifts: Readonly<Record<string, LiftRecord>>;
  ciChoice: 'light' | 'swap' | 'orig' | null;
  checkin: CheckIn;
  /** Focus muscles (contract `Settings.focus`); empty until the app stores settings. */
  focus: readonly string[];
}

export interface BuiltSession {
  /** Exercises in session order, with their working-set counts. */
  exercises: { name: string; sets: number; bridge: boolean }[];
  mods: { light: boolean; short: boolean; where: Where; deload: boolean; reentry: number };
  /** Names the template has that this session leaves out (they rotate in on other days). */
  left: string[];
  /** The exercises `applyFocus` added, for the focus badge. */
  focus: string[];
}

/**
 * Today's session for a template, in the prototype's `buildSession` order: home mapping, swaps and
 * exclusions, trim to the session length, focus, the check-in short cut, then set counts. Every step is core's.
 * Exclusions, swaps and recovery weeks are settings the app does not store yet, so they are empty.
 */
export function buildSession(i: BuildInput): BuiltSession {
  const names = mapForWhere([...(TEMPLATES[i.template] ?? [])], i.where, catalog);
  const resolve = { exclusions: [], swaps: [], lifts: i.lifts, date: i.date };
  const all: SessionItem[] = resolveSession(names, i.where, resolve, catalog);
  const state = { profile: i.profile, sessions: i.sessions };
  let items = applyFocus(trimSession(all, i.template, state), i.template, i.where, { profile: i.profile, lifts: i.lifts, focus: i.focus }, catalog);
  items = shortSession(items, i.checkin.time);
  const short = !!i.checkin.time && i.checkin.time !== 'usual';
  const light = i.ciChoice === 'light' || needsClearance(i.profile);
  const sets = sessionSets(items, {
    profile: i.profile,
    date: i.date,
    focus: i.focus,
    tags: catalog.tags,
    lastSets: (n) => lastFor(n, i.lifts, i.date)?.sets.length,
    light,
  });
  const kept = new Set(items.map((x) => x.name));
  return {
    exercises: sets.map((e) => ({ name: e.name, sets: e.sets, bridge: !!e.bridge })),
    mods: { light, short, where: i.where, deload: false, reentry: 0 },
    left: all.filter((x) => !kept.has(x.name)).map((x) => x.name),
    focus: items.filter((x) => x.focus).map((x) => x.name),
  };
}
