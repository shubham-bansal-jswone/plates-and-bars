# ADR 001: Stack (Expo, Spring Boot, MySQL) and offline-first sync

- Status: Accepted
- Date: 2026-10-08

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
  - Every user-owned record has a client-made UUID, a `version`, `updated_at` and `deleted_at`. Records unique per natural key (one profile, one day note per day, one lift history per exercise) use a deterministic UUIDv5 so two offline devices agree on the id.
  - Writes are version-checked: the server applies a change only when the version the device last saw matches the stored one.
  - On a mismatch the newer edit (by `updated_at`) wins for the whole record; the losing copy is kept in a server-side conflict log and reported back to the device.
  - Deletes are soft (tombstones) so they reach every device.
  - The device pulls changes since an opaque cursor in the same round trip.

## Consequences

- One language (TypeScript) for app and rules, and the developer's strongest stack on the server.
- The app keeps working with no connection; sync bugs become the highest-risk code and get the heaviest tests (backend Testcontainers tests, an offline end-to-end test).
- Record-level last-writer-wins can drop a field edit made on another device at nearly the same time. That is acceptable for single-user data and recoverable from the conflict log; field-level merging can be added later if it proves necessary.
- Device clocks decide conflicts, so the server clamps `updated_at` values in the future.
- Tombstones accumulate; a purge policy is needed before the tables grow large.
- The EAS free tier limits monthly builds, so local Gradle builds are the fallback for Android.
