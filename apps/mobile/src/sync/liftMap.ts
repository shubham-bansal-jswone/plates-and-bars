import type { LiftRecord, LiftSession } from '@plate-and-bar/core';
import type { Schemas } from '@plate-and-bar/api';

// TODO(#135): core owns this mapping (liftStatToRecord / recordToLiftStat, with the older-record fallbacks) and has not
// shipped it yet. This is the minimal client-side version; replace it with core's functions when they land.

type LiftStat = Schemas['LiftStat'];
type WireSession = Schemas['LiftSession'];
type WireSet = Schemas['LiftSet'];

const toWireSets = (sets: LiftSession['sets']): WireSet[] => sets.map((s) => ({ weight_kg: s.w, reps: s.r, rate: s.rate ?? null }));
const fromWireSets = (sets: WireSet[]): LiftSession['sets'] => sets.map((s) => (s.rate ? { w: s.weight_kg, r: s.reps, rate: s.rate } : { w: s.weight_kg, r: s.reps }));

/** Core's lift record to the contract's LiftStat body (the sync metadata is added by the caller). */
export function recordToLiftStat(exercise: string, l: LiftRecord): Omit<LiftStat, 'id' | 'version' | 'updated_at' | 'deleted_at'> {
  const session = (s: LiftSession): WireSession => ({ date: s.date, sets: toWireSets(s.sets), form: s.form ?? null });
  // The contract rejects a nested prev that has a `prev` key at all, so the inner session never carries one.
  const prev = l.prev ? { ...session(l.prev), ...(l.prev.prev ? { prev: session(l.prev.prev) } : {}) } : null;
  return {
    exercise,
    date: l.date,
    sets: toWireSets(l.sets),
    form: l.form ?? null,
    sessions: l.n || (l.prev ? 2 : 1),
    first: l.first || l.prev?.date || l.date,
    prev,
    history: (l.hist ?? []).slice(-8).map((h) => ({ date: h.date, score: h.e })),
    pb_toast_date: l.pbToast ?? null,
  };
}

/** The contract's LiftStat to core's lift record. */
export function liftStatToRecord(s: LiftStat): LiftRecord {
  const inner = (p: WireSession): LiftSession => ({ date: p.date, sets: fromWireSets(p.sets), form: p.form ?? null });
  const prev = s.prev ? { ...inner(s.prev), ...(s.prev.prev ? { prev: inner(s.prev.prev) } : {}) } : null;
  return {
    date: s.date,
    sets: fromWireSets(s.sets),
    form: s.form ?? null,
    n: s.sessions,
    first: s.first,
    prev,
    hist: s.history.map((h) => ({ date: h.date, e: h.score })),
    pbToast: s.pb_toast_date ?? null,
  };
}
