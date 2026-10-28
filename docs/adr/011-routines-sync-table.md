# ADR 011: Saved routines are a new synced table

- Status: Accepted
- Date: 2026-10-28
- Adds to: [ADR 001](001-stack-and-offline-first-sync.md) (offline-first sync). Whole-record last-writer-wins, tombstones and the account record cap stand unchanged.
- Decided on #1184 (owner approved the feature on 2026-10-28); contract 0.1.27.

## Context

Users want to save a named workout (exercises with set counts) and start it later. Sync has 16 tables, described as fixed. `Settings` is one natural-key record per user with record-level last-writer-wins, so a routine edit on one device and an unrelated settings edit on another would overwrite each other. Two routines edited on two devices would conflict for the same reason.

## Decision

- A 17th table, `routines`, one record per routine: the usual `id`, `version`, `updated_at`, `deleted_at` (soft delete) plus `name`, `exercises[]` and `created_at`. Random UUIDv4 id, no natural key, so different routines never share a record and never conflict. It is in `SyncTable`, `SyncChanges`, `SyncRecord` and `ExportTables` (so `GET /me/export` and the device export include it).
- `exercises[]` is an ordered list of `{ name, sets, part? }`. Reps and weights are not stored; they come from progression when the routine is started. `name` is the exercise name as other records carry it (no id: workouts, sets and lift stats reference exercises by name). A removed catalogue exercise keeps its name; the app flags it at start.
- Bounds, each with its reason:
  - `name`: 1 to 60 characters, not blank (shared blank pattern). Fits a list row.
  - `exercises`: 1 to 50 items. 50 equals `Workout.exercises`, so any session the app can store can be saved as a routine; an empty routine cannot be saved.
  - exercise `name`: 1 to 200, as every other exercise name in the contract.
  - `sets`: integer 1 to 20. A guard against corrupt values, not a training rule.
  - `part`: optional 1 or 2, as `WorkoutExercise.part`, so a two-part session round-trips.
  - Per account: at most 100 routines that are not deleted. A push that would exceed it is refused whole with 400 `invalid_request`, issue `too_many_routines`, field `changes.routines[<i>]`. Tombstones do not count here but still count against the account record cap. The app enforces the same number before saving.
- The exercise object is closed. A later field (a superset group, #1182) is added as an optional property in a new contract version; no existing record becomes invalid.
- Additive change: a patch-level bump to 0.1.27 (the 0.x minor stays), not BREAKING. A client or server that predates the table never sends or stores `routines`; `SyncChanges` omits tables with no changes. `ExportTables` lists `routines` as required, so an export from a new server has the key; readers of an export from an older server must treat it as empty.

## Consequences

- Backend: a migration for the table (same shape as the other 16: `data JSON`, `seq`), `SyncTable` gains a value, the validator learns the schema and the 100-routine check. App: a local table, outbox trigger pair, `SYNC_TABLES` entry and an export entry. These follow in their own PRs against the merged contract.
- Two devices editing different routines never conflict. The same routine edited on two devices is settled by `updated_at` like any table, and the loser is kept in the conflict log.
- Tables rise to 17, so docs that say "16 tables" (LLD, plan) need updating by their owner.
- A 100-routine cap can leave a device holding a routine the server refuses; the app quarantines the refused record as for other 400s. This is a guard for old clients and second devices, as the app stops the user first.
