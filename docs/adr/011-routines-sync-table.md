# ADR 011: Saved routines are a new synced table

- Status: Accepted
- Date: 2026-10-28
- Adds to: [ADR 001](001-stack-and-offline-first-sync.md) (offline-first sync). Whole-record last-writer-wins, tombstones and the account record cap stand unchanged.
- Decided on #1184 (owner approved the feature on 2026-10-28); contract 0.1.27.

## Context

Users want to save a named workout (exercises with set counts) and start it later. Sync has 16 tables, described as fixed. `Settings` is one natural-key record per user with record-level last-writer-wins, so a routine edit on one device and an unrelated settings edit on another would overwrite each other. Two routines edited on two devices would conflict for the same reason.

## Decision

- A 17th table, `routines`, one record per routine: the usual `id`, `version`, `updated_at`, `deleted_at` (soft delete) plus `name`, `exercises[]` and `created_at`. Random UUIDv4 id, no natural key, so different routines never share a record and never conflict. It is in `SyncTable`, `SyncChanges`, `SyncRecord` and `ExportTables` (so `GET /me/export` and the device export include it).
- `exercises[]` is an ordered list of `{ name, sets }`. Reps and weights are not stored; they come from progression when the routine is started. `name` is the exercise name as other records carry it (no id: workouts, sets and lift stats reference exercises by name). A removed catalogue exercise keeps its name; the app flags it at start.
- Bounds, each with its reason:
  - `name`: 1 to 60 characters (code points), not blank (shared blank pattern). Fits a list row.
  - `exercises`: 1 to 50 items. 50 equals `Workout.exercises`, so any session the app can store can be saved as a routine; an empty routine cannot be saved.
  - exercise `name`: 1 to 200, not blank.
  - `sets`: integer 1 to 20. A guard against corrupt values, not a training rule.
  - Per account: at most 100 live routines, as `x-max-live-records: 100` on `Routine`. It copies the record-cap rule: the server refuses only when the push holds a new or revived routine and the live count after apply (last-writer-wins resolved) is over 100, inside the per-account serialised transaction, after request validation and before the account record cap. The refusal is 400 `invalid_request` with one `details` entry per over-limit new or revived routine, issue `too_many_routines`, so the app sets them all aside in one round. Edits, renames, deletes and pull-only requests are never refused, even for an account already over 100. Tombstones do not count here but count against the account record cap. The app enforces the same number before saving.
  - A routine has no `part`: starting a routine always creates a fresh session.
- `RoutineExercise` is bounded-open exactly as `WorkoutExercise` (at most 20 keys, key names at most 50, unlisted values boolean, number, string up to 200, or null). A later field (a superset group, #1182) is added as an optional property, and an app that rewrites a routine keeps the exercise keys it does not know, so an older app never drops a newer client's field. Exercise names use the shared blank pattern.
- Additive change: a patch-level bump to 0.1.27 (the 0.x minor stays), not BREAKING. A client or server that predates the table never sends or stores `routines`; `SyncChanges` omits tables with no changes. `ExportTables.routines` is optional: a server built against 0.1.26 omits it, and a missing key means empty. A new server always sends it.

## Consequences

- Backend: a migration for the table (same shape as the other 16: `data JSON`, `seq`), `SyncTable` gains a value, the validator learns the schema and the 100-routine check. App: a local table, outbox trigger pair, `SYNC_TABLES` entry and an export entry. These follow in their own PRs against the merged contract.
- Two devices editing different routines never conflict. The same routine edited on two devices is settled by `updated_at` like any table, and the loser is kept in the conflict log.
- Tables rise to 17, so docs that say "16 tables" (LLD, plan) need updating by their owner.
- A 100-routine cap can leave a device holding a routine the server refuses; the app quarantines the refused record as for other 400s. This is a guard for old clients and second devices, as the app stops the user first.

## Rollout

1. Backend prep PR (#1281): the contract may list tables the backend does not implement, and the server refuses each record of such a table with a per-record `unsupported_table` refusal instead of dropping it. Merges first.
2. This contract PR.
3. The backend `routines` PR (migration, `SyncTable`, validator, the cap).
4. The app.

An app that sends `routines` to a server that does not store them gets `unsupported_table` per record, sets those records aside and retries them on a later sync; the rest of the push (food logs and so on) goes through. No capability flag is needed. The app never sends `routines` against a server that answers 400 on `changes` as a whole, because step 1 is deployed before any app build that has the table.

## More consequences

- An app build that predates the table ignores `changes.routines` on pull while its cursor moves past those records. The app PR that adds the table must do one full re-pull of `routines` (reset the cursor once, or a one-time full pull) when it first runs after upgrade.
