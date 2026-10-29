# ADR 012: Exercise groups (supersets) on session and routine exercises

- Status: Accepted
- Date: 2026-10-29
- Adds to: [ADR 001](001-stack-and-offline-first-sync.md), [ADR 007](007-sync-conflict-replaced-record.md) (merge on conflict), [ADR 011](011-routines-sync-table.md) (reserved a superset group on `RoutineExercise`).
- Amended 2026-10-29: the invalid routine `group` vectors were re-added to `routines.json` with the app check (#1335). No decision changed.
- Decided on #1182 (owner delegated the decision to the coordinator, 2026-10-28); contract 0.1.28.

## Context

Users want supersets: two or more exercises whose sets alternate, with rest after the round. The server holds no training rules, so it only needs to store and sync which exercises belong together. `WorkoutExercise` and `RoutineExercise` are bounded-open objects (at most 20 keys), so a listed optional property is additive.

## Decision

- One optional, nullable property `group` on `WorkoutExercise` and on `RoutineExercise`: a short id string matching `^[A-Za-z0-9_-]{1,36}$` (1 to 36 ASCII letters, digits, underscore, hyphen; a UUID fits). Null or absent means ungrouped.
- Members of a group are contiguous in `exercises[]`. There is no position field: the array order is the order. A group has 2 to 6 members; that is a core constant, not enforced by the contract schema, so a limit change needs no contract bump.
- Labels (A1, A2, B1) are derived by the app, never stored. Progression, records and history stay per exercise name.
- A client that does not know the field may drop it when it rewrites the exercise, as with `feel` (workouts; routines keep unknown keys, so they carry it). The invalid routine `group` vectors (37 characters, a space, empty) were left out of `routines.json` until the app checked `group` in `createRoutine`; they were re-added with that check in #1335 (S6a of #1182), and the app test also runs every `exercise-group.json` vector through `createRoutine`. Additive patch bump to 0.1.28, not breaking.
- Merge: the three-way merge compares keys, so ungrouping must be written as an explicit `null`, not by deleting the key, or the other device's group would win back.
- Routines store the group, so a saved superset starts as a superset. Starting a routine creates a session with fresh group ids (ids are regenerated per session), so two sessions never share one.
- Timed circuits (time-based, 3+ exercises) are deferred; they would be a later, separate contract change.

## Consequences

- No migration and no new table: `exercises` is stored as JSON. Backend change is none beyond contract tests.
- Core owns contiguity, the member cap and the rest rules; a record that breaks them (for example from a buggy client) is stored as sent and repaired by core on read.
- Importers (such as a Hevy `superset_id`) map their ids to group ids on the client.
