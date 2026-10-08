# Plate & Bar backend

Spring Boot 3 (Java 21), Gradle, MySQL 8, Flyway, Spring Security. The API contract is
`packages/api/openapi.yaml`; every route lives under `/api/v1`.

## Status (M0)

- `GET /api/v1/health` is public (200 `{status, version}`, 503 `Error` when the database is unreachable).
- Auth (#33, ADR 003 and 004), all public under `/api/v1/auth`:
  - `POST /google`: verifies a Google ID token against Google's JWKS (issuer, audience from `GOOGLE_CLIENT_IDS`,
    expiry). `email_verified` must be true. Identities are keyed by `sub`; the normalised email (trim, lower-case)
    is used once to join an existing account, and an existing Google identity is never re-pointed.
  - `POST /email/start`: always 202 for a well-formed address. 6-digit code, 10 minute expiry, stored as an HMAC
    digest, one row per address (a new code replaces the old one).
  - `POST /email/verify`: single-use code, invalidated after 5 wrong attempts, any failure is 401 `invalid_code`.
  - `POST /refresh`: opaque `rt_...` token stored as SHA-256 with a family id; 90 days, restarted on every
    rotation. Presenting a rotated token revokes the whole family. Any refusal is 401 `unauthorized`.
  - Access token: HS256 JWT, 15 minutes, `sub` is the user id.
- Every other route under `/api/v1` requires `Authorization: Bearer <access token>`; `JwtAuthFilter` answers 401
  `token_expired` or `unauthorized` in the contract's `Error` shape. The principal is the user id string.
- Mail goes through the `MailSender` interface. `LoggingMailSender` (local and staging) logs only that a code was
  issued, never the code or the address. A real provider is a later issue.
- Flyway: `V1__baseline.sql` (`users`, `auth_identities`, `refresh_tokens`), `V2__email_sign_in_codes.sql`, `V3__email_verify_failures.sql`, `V4__sync_tables.sql` (the 16 sync tables, `sync_state`, `sync_conflicts`).
- All errors use the contract's `Error` schema (`common/ApiExceptionHandler`).
- Rate limits (`ratelimit` package, Bucket4j 8, Apache-2.0, in memory), all answering 429 `rate_limited` in the
  `Error` shape with `Retry-After` (seconds):
  - Per client IP on every `/auth/*` endpoint including `/auth/google` (default 30 per minute, one shared bucket),
    plus stricter buckets for `/auth/email/start` (10 per hour) and `/auth/email/verify` (30 per hour).
  - Per user id on every authenticated endpoint (120 per minute). Requests without a token, or with a rejected
    (invalid or expired) one, count against the IP bucket instead, so garbage tokens cannot be replayed for free.
  - Per address on `/auth/email/start`: 5 codes per hour and 10 per day.
  - Per address wrong-code cap across all codes: 10 per hour and 20 per day, rolling, persisted in
    `email_verify_failures` (V3). A new code does not reset it; while capped even the right code is refused.
    It is in the database, not memory, so a restart or deploy cannot be used to reset a guessing budget.
  - `/health` has its own generous per-IP limit (120 per minute) so probes are never throttled in practice.
  - Buckets live in a bounded Caffeine cache (Apache-2.0): at most `app.rate-limit.max-tracked-keys` (100000), idle
    buckets expire after their longest window. Address-keyed buckets (code issuance) have their own cache
    (`app.rate-limit.address-max-tracked-keys`) so an IP-keyed flood cannot evict them. Within a cache, eviction under
    pressure can forgive an evicted key; the email guessing cap is unaffected because it is in MySQL. Limits are configuration (`app.rate-limit.*`, see below).
- Sync (#28, ADR 001): `POST /api/v1/sync`, the whole offline-first round trip in one transaction. See "Sync" below.
- Not yet: `GET /me/export`, `DELETE /me`, foods, content and the AI proxy.

## Sync

Package `app.plateandbar.api.sync`. The user is always the token's principal; no body field names a user.

- **Storage.** One table per contract `SyncTable` (`profiles`, `food_logs`, ... `settings`), all the same shape:
  `user_id, id, version, updated_at, deleted_at, seq, data JSON`, primary key `(user_id, id)`. `data` holds the
  record's other fields, so the engine is generic over tables. Foreign key to `users` with `ON DELETE CASCADE`.
  `sync_state` holds one row per user with the change counter `seq`; `sync_conflicts` is the conflict log.
  Deletes are soft (`deleted_at`).
- **Validation.** The body is validated against the schemas in the contract (`SyncRequestValidator`), using
  networknt json-schema-validator against `src/main/resources/openapi.yaml`, a verbatim copy of
  `packages/api/openapi.yaml` (the Docker build context is `backend/`, so it cannot read the original).
  `SyncContractIT.theBundledContractIsTheContract` fails if the copy drifts: copy the file again. Any problem is
  400 `invalid_request` for the whole request with `details` naming the field and the failed keyword, never the
  value. Beyond the schema: at most 500 records in total, no id twice in one request, ids lower-cased, and
  natural-key tables (`profiles`, `settings`, `day_notes`, `workouts`, `weights`, `measurements`, `lift_stats`,
  `swaps`) must use the UUIDv5 of `<table>:<key>` in the user's namespace. Unknown record fields are dropped.
- **Locking.** Each sync locks the user's `sync_state` row (`SELECT ... FOR UPDATE`), so two devices of one user sync
  one after the other and change numbers are assigned in commit order. Different users never contend.
- **Push**, per record with the version `v` the device last saw: no stored record means it is stored as version 1;
  `v` equal to the stored version stores `version + 1`; otherwise a conflict. If the content apart from `version`
  and `updated_at` equals the stored record (and both or neither are deleted) it is a retry: `server_won`, nothing
  written, nothing logged. Otherwise the later `updated_at` wins and a tie goes to the server; the loser is
  written to `sync_conflicts` with its version, `updated_at`, `deleted_at` and fields.
- **Clock.** `updated_at` and `deleted_at` more than 5 minutes ahead of the server clock are stored as server time.
- **Pull.** Records with `seq` greater than the cursor, oldest change first, at most 500 per response with
  `has_more`. The cursor is `c_` plus the user's change number as 16 hex digits. A request's own writes are not
  echoed back in the same response. A first sync (cursor null) leaves tombstones out. A cursor this user has
  never been given (ahead of their counter) or in any other shape is 400.
- A token for an account that no longer exists is 401 `unauthorized`.
- Nothing in this package logs. `application.yml` pins Spring's body and SQL-parameter loggers to INFO because
  they print whole records at DEBUG or TRACE.

## Run

Needs JDK 21 and a MySQL 8 database.

```sh
cd backend
DB_URL=jdbc:mysql://localhost:3306/plateandbar DB_USER=plateandbar DB_PASSWORD=... JWT_SIGNING_KEY=... GOOGLE_CLIENT_IDS=... ./gradlew bootRun
curl localhost:8080/api/v1/health
```

Docker (multi-stage, works on arm64 and amd64):

```sh
docker build -t plateandbar-api backend
docker run --rm -p 8080:8080 -e DB_URL=... -e DB_USER=... -e DB_PASSWORD=... \
  -e JWT_SIGNING_KEY=... -e GOOGLE_CLIENT_IDS=... plateandbar-api
```

## Test

```sh
cd backend
./gradlew build      # compile, all tests, bootJar (the command CI will run; the workflow lands in PR #38)
./gradlew test
```

`HealthMigrationIT`, `AuthFlowIT`, `RateLimitIT` and the sync ITs (`SyncEngineIT`, `SyncIsolationIT`, `SyncContractIT`, `SyncMigrationIT`) use Testcontainers to start MySQL 8, so Docker must be running.
`HealthControllerTest`, `AuthControllerTest`, `SyncControllerTest`, `JwtAuthFilterTest` and `RateLimitFilterTest` are WebMvc tests;
`UuidsTest`, `JsonContentTest`, `CursorTest`, `JwtServiceTest`, `GoogleIdTokenVerifierTest`, `RateLimiterTest` and `ClientIpResolverTest` are plain unit tests. None of these need Docker. Gradle sets throwaway
`JWT_SIGNING_KEY` and `GOOGLE_CLIENT_IDS` for tests; run tests from an IDE with the same variables.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_URL` | `jdbc:mysql://localhost:3306/plateandbar` | JDBC URL |
| `DB_USER` | `plateandbar` | Database user |
| `DB_PASSWORD` | empty | Database password |
| `PORT` | `8080` | HTTP port |
| `APP_VERSION` | `0.1.0` | Value returned as `version` by `/health` |
| `JWT_SIGNING_KEY` | none, required | HS256 key for access tokens and code digests, at least 32 bytes. The app refuses to start without it |
| `GOOGLE_CLIENT_IDS` | empty | Comma-separated OAuth client ids accepted as the Google ID token audience; empty refuses every Google sign-in |

Rate limits are `app.rate-limit.<name>.capacity` and `.window` (a duration such as `60s`), for
`health-per-ip`, `public-per-ip`, `email-start-per-ip`, `email-verify-per-ip`, `authenticated-per-user`, and
`email-start-per-address` and `verify-failures-per-address` (each with `burst` and `sustained`). Set them in
`application.yml` or as environment variables (`APP_RATELIMIT_PUBLICPERIP_CAPACITY=60`).

### Client IP and proxies

The client IP is the socket peer. `X-Forwarded-For` is ignored unless the peer is listed in
`app.rate-limit.trusted-proxies` (env `APP_RATELIMIT_TRUSTEDPROXIES`, comma-separated IPs or CIDR ranges, empty by
default). For a trusted peer the header is read from the right and the first hop that is not itself a trusted
proxy is the client; a malformed header, or a hop that is not a plain IP literal (a hostname, or an address
with a port such as `1.2.3.4:80`), falls back to the proxy's address. Hostnames are never resolved. Staging sits behind a reverse proxy (Caddy, #36), so `trusted-proxies` must be set there. Behind a reverse proxy set the list to the proxy's
address, otherwise every request shares the proxy's bucket. IPv6 clients are keyed by their /64. The in-memory
buckets are per process: run one instance, or move them to a shared store before scaling out.

Secrets come from the environment only. Logs must never contain food, weight, health answers or tokens.

## Layout

Package by feature under `app.plateandbar.api`: `health`, `auth`, `common` (shared error handling);
later `sync`, `foods`, `content`, `ai`, `account`.
