import { useContext } from 'react';
import { SyncContext } from './SyncProvider';

/** Bumps after a sync stored pulled records (0 without a SyncProvider, e.g. in a local-only build). Screens use it as a reload key. */
export function useDataVersion(): number {
  return useContext(SyncContext)?.dataVersion ?? 0;
}
