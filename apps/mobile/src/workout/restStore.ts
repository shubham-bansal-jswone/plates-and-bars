import { useEffect, useRef } from 'react';
import type { StoreDb } from '../db/records';
import { KEY_REST, getKv, setKv } from '../sync/store';
import type { RestState } from './parts';

/** The stored rest if it is still running and started on `date`; anything else (damaged, elapsed, another day) reads as none. */
export function parseRest(raw: string | null, date: string, now: number): RestState | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<RestState>;
    const ok = typeof r.id === 'number' && typeof r.end === 'number' && typeof r.total === 'number' && typeof r.label === 'string' && (!r.from || Array.isArray(r.from)) && (!r.at || (typeof r.at.i === 'number' && typeof r.at.name === 'string')) && (!r.to || (typeof r.to.ex === 'number' && typeof r.to.set === 'number' && typeof r.to.name === 'string'));
    return ok && r.date === date && (r.end as number) > now ? (r as RestState) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the rest dock across a reload (#1143). It stores the end time (not a ticking value), so the dock resumes with the time left.
 * Whether the exercises in its list still have an undone set is checked by the screen as for any rest. Native: the same row also
 * lets the dock come back after the process is killed.
 */
export function usePersistedRest(db: StoreDb, rest: RestState | null, setRest: (r: RestState | null) => void, date: string) {
  const loaded = useRef(false);
  const restRef = useRef(rest);
  useEffect(() => {
    restRef.current = rest;
  }, [rest]);
  useEffect(() => {
    let live = true;
    void getKv(db, KEY_REST).then((raw) => {
      if (!live) return;
      loaded.current = true;
      // A rest ticked before the read finished wins (and is stored now: its own save was skipped).
      const r = restRef.current ? null : parseRest(raw, date, Date.now());
      if (r) setRest(r);
      else void (restRef.current ? setKv(db, KEY_REST, JSON.stringify(restRef.current)) : db.runAsync('DELETE FROM settings WHERE key = ?', KEY_REST)).catch(() => undefined);
    }, () => { loaded.current = true; });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per mount
  }, [db]);
  useEffect(() => {
    if (!loaded.current) return;
    void (rest ? setKv(db, KEY_REST, JSON.stringify(rest)) : db.runAsync('DELETE FROM settings WHERE key = ?', KEY_REST)).catch(() => undefined);
  }, [db, rest]);
}
