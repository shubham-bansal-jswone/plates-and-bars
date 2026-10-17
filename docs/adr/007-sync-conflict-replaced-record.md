# ADR 007: Sync conflicts return the replaced record on client_won

- Status: Accepted
- Date: 2026-10-18
- Adds to: [ADR 001](001-stack-and-offline-first-sync.md) (offline-first sync). Whole-record last-writer-wins and the conflict log stand unchanged.
- Decided on #792 (option 2) by the coordinator under the owner's delegation of owner-level decisions; contract 0.1.20.

## Context

ADR 001 settles a version mismatch whole-record by `updated_at` and keeps the losing copy in a server-side conflict log. On `server_won` the device still holds its own losing copy, so it can combine the two before it adopts `server_record`. On `client_won` it cannot: `server_record` is its own edit, and the copy it replaced exists only in the conflict log, which the app never reads.

For workouts this loses data the user sees (#647, #789, #792). One device stores a day's cardio minutes, another stores a session for the same day, and the later edit replaces the earlier whole. #789 narrowed the window with a pull before the push and a union for days that never saw a server copy. One sync round trip remains open: another device stores the day between this device's pull and its push, and this edit is later.

Options on #792:
1. Merge `workouts` fields on the server. This puts app rules (which session fields to union, which `cardio_min` to keep) in the backend, against ADR 001's "the server stores, syncs and guards".
2. Return the replaced record in the `client_won` conflict, so the app can merge and push again.

## Decision

- `SyncConflict` gains an optional `replaced_record` (a `SyncRecord`, schema picked by `table`).
- The server sets it on every `client_won` conflict to the copy it replaced, exactly as stored (`version` = `server_version` - 1, `deleted_at` as stored). This is the copy the conflict log keeps with `loser: server`. It is absent on `server_won`, idempotent retries included, because there the losing copy is the device's own push.
- The field is generic: every synced table gets it. The server never merges. Whether two copies of a table can be combined, and when that is safe, is the app's rule. A merged result goes back as an ordinary edit at `server_version`, version-checked like any push.
- It uses the same record schemas, so every record bound applies to it (`maxLength`, `maxItems`, `maxProperties`, `x-max-json-bytes`). The server already stored the record, so it met those bounds when it was stored.
- The change is additive (a patch bump to 0.1.20). A server built against 0.1.19 or earlier never sends the field, and a `client_won` conflict without it means the replaced copy is only in the conflict log, as before.

## Consequences

- The backend change is small: it adds the stored copy it already logs to the conflict entry. No schema migration is needed.
- The app can close the #792 window for workouts, and for any other table where it later defines a safe merge. The safety rule from #789 still applies: union only when no removal can come back. A day this device had already synced has a common base with the replaced copy, and a two-way union would bring a removed exercise or cleared minutes back. The app's merge is its own follow-up.
- Responses had no byte limit before this change and still have none; the 500 cap on a response page counts pulled records in `changes`, not bytes, and replaced records do not count toward it. A `client_won` conflict used to carry only the device's edit and now also carries the stored copy that edit replaced, so a response grows by at most one stored record per pushed record (at most 500), each within its table's record bounds. That copy can be larger than the edit that replaced it, so the growth is not bounded by the 2 MB request limit.
- No new data crosses the boundary: the replaced copy is the same user's record, which the device would get on its next pull anyway if it had not been replaced.
- The conflict log stays the safety net for devices that do not merge, for old servers, and for a `client_won` whose answer was lost. The device then retries, the retry resolves as an idempotent `server_won` without `replaced_record`, and the other device's copy is then only in the server's conflict log.
