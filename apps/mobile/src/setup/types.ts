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
   * Null on a row made on the device, the server id on a pulled one. Profile is a natural-key table (one per user): its contract id is the UUIDv5 of
   * `profiles:me`, computed at push time for the signed-in user (sync/records.ts buildRecord, same value either way); no device namespace is invented
   * here (see /sync "Record ids").
   */
  id: string | null;
}

/** Contract `Consent`. */
export interface Consent extends SyncMeta {
  kind: 'data_storage';
  given_at: string;
  text_version: string;
}
