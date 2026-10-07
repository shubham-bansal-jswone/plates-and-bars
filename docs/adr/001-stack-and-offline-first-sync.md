# ADR 001: Stack (Expo, Spring Boot, MySQL) and offline-first sync

- Status: Accepted
- Date: 2026-10-08
- Amended 2026-10-08: corrected in place the same day it merged (issue #5). The sync decision now states user scoping, the UUIDv5 namespace, the tie rule and what never syncs; the tombstone consequence now says how a long-offline device recovers. No decision changed.

## Context

Plate & Bar has to ship on Android and the web first and iOS later, built part-time by one developer with AI agents, at close to zero running cost. The working prototype is a single JavaScript file whose rules (targets, plan engine, progression, food maths) are the specification. People log sets in gyms with poor signal, so nothing a user does may depend on a live connection or be lost to one.

## Decision

- **App:** React Native with Expo (TypeScript, Expo Router), one codebase for Android, web and iOS. Records live in expo-sqlite, photos in expo-file-system, tokens in expo-secure-store.
- **Shared rules:** `packages/core` in TypeScript, ported from the prototype and tested against golden fixtures. The app runs every rule; the backend may use the same package to check, never to re-implement.
- **Backend:** Java 21, Spring Boot 3, Gradle. It stores, syncs and guards (auth, quotas, the AI proxy) and holds no product rules.
- **Database:** MySQL 8 with Flyway migrations.
- **Contract first:** the OpenAPI spec in `packages/api` is agreed before implementation; the app uses a client generated from it.
- **Offline-first sync** through one `POST /sync` endpoint:
  - Every change is written to the device first and queued.
  - Every synced record belongs to exactly one user (`user_id`), and every sync read and write is scoped to the authenticated user.
  - Every user-owned record has a client-made UUID, a `version`, `updated_at` and `deleted_at`. Records unique per natural key (one profile, one day note per day, one lift history per exercise) use a deterministic UUIDv5 whose namespace is the user's id, so two offline devices of the same user agree on the id.
  - Writes are version-checked: the server applies a change only when the version the device last saw matches the stored one.
  - On a mismatch the newer edit (by `updated_at`) wins for the whole record, and a tie on `updated_at` goes to the server; the losing copy is kept in a server-side conflict log and reported back to the device.
  - Deletes are soft (tombstones) so they reach every device.
  - The device pulls changes since an opaque cursor in the same round trip.
  - Never synced in v1: progress photos, kitchen-test photos, cycle data and lab results. They stay on the device and have no server table.

## Consequences

- One language (TypeScript) for app and rules, and the developer's strongest stack on the server.
- The app keeps working with no connection; sync bugs become the highest-risk code and get the heaviest tests (backend Testcontainers tests, an offline end-to-end test).
- Record-level last-writer-wins can drop a field edit made on another device at nearly the same time. That is acceptable for single-user data and recoverable from the conflict log; field-level merging can be added later if it proves necessary.
- Device clocks decide conflicts, so the server clamps `updated_at` values in the future.
- Tombstones accumulate; a purge policy is needed before the tables grow large and is left to a later ADR. Whatever window it sets, a device offline for longer than that window has missed deletes whose tombstones may be gone; the contract has no way yet to tell a device its cursor is too old, so the purge ADR must define that signal and the recovery (a full pull with `cursor: null` after pushing queued changes, treating synced records absent from the pull as deleted).
- The EAS free tier limits monthly builds, so local Gradle builds are the fallback for Android.
