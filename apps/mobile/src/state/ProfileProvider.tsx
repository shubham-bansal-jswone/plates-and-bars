import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadConsent, loadProfile, newId, saveConsent, saveProfile, type StoreDb } from '../db/records';
import { CONSENT_TEXT_VERSION } from '../setup/copy';
import { localDate } from '../setup/logic';
import type { Consent, Profile } from '../setup/types';

export type Status = 'loading' | 'ready';

interface ProfileState {
  status: Status;
  profile: Profile | null;
  consent: Consent | null;
  /** True after "Skip for now" this session: the app stays out of setup until the next launch. */
  skipped: boolean;
  skipSetup(): void;
  /** Writes the consent record to the local database, then updates state. */
  giveConsent(): Promise<void>;
  /** Writes the profile, then updates state. */
  setProfile(p: Profile): Promise<void>;
  /** "My doctor has cleared me": sets `cleared` to today. */
  markCleared(): Promise<void>;
}

const Ctx = createContext<ProfileState | null>(null);

const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Holds the local profile and consent. Every write goes to SQLite first; nothing waits on the network. */
export function ProfileProvider({ db, children }: { db: StoreDb; children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [skipped, setSkipped] = useState(false);
  const skipSetup = useCallback(() => setSkipped(true), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [p, c] = await Promise.all([loadProfile(db), loadConsent(db)]);
      if (!live) return;
      setProfileState(p);
      setConsent(c);
      setStatus('ready');
    })();
    return () => {
      live = false;
    };
  }, [db]);

  const giveConsent = useCallback(async () => {
    const now = new Date();
    const c: Consent = {
      id: newId(),
      version: 0,
      updated_at: stamp(now),
      deleted_at: null,
      kind: 'data_storage',
      given_at: stamp(now),
      text_version: CONSENT_TEXT_VERSION,
    };
    await saveConsent(db, c);
    setConsent(c);
  }, [db]);

  const setProfile = useCallback(
    async (p: Profile) => {
      await saveProfile(db, p);
      setProfileState(p);
    },
    [db],
  );

  const markCleared = useCallback(async () => {
    if (!profile) return;
    const now = new Date();
    const next = { ...profile, cleared: localDate(now), updated_at: stamp(now) };
    await saveProfile(db, next);
    setProfileState(next);
  }, [db, profile]);

  const value = useMemo(
    () => ({ status, profile, consent, skipped, skipSetup, giveConsent, setProfile, markCleared }),
    [status, profile, consent, skipped, skipSetup, giveConsent, setProfile, markCleared],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfile(): ProfileState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProfile needs a ProfileProvider');
  return v;
}
