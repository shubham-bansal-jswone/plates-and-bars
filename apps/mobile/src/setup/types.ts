import type { SetupProfile } from '@plate-and-bar/core';

/** Fields every synced record carries (contract `SyncMeta`). */
export interface SyncMeta {
  id: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

/** Contract `Profile`, snake_case as in packages/api/openapi.yaml: core's `SetupProfile` plus sync metadata. */
export interface Profile extends Omit<SyncMeta, 'id'>, SetupProfile {
  /**
   * Null locally. Profile is a natural-key table (one per user): its contract id is the UUIDv5 of
   * `profiles:me`, computed once the store is bound to a signed-in user (#31) or at push time.
   * TODO(#31): fill in `id` then; no device namespace is invented here (see /sync "Record ids").
   */
  id: null;
}

/** Contract `Consent`. */
export interface Consent extends SyncMeta {
  kind: 'data_storage';
  given_at: string;
  text_version: string;
}
