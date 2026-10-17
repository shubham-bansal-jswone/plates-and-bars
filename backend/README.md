# Plate & Bar backend

Spring Boot 4.1 (Spring Framework 7, Spring Security 7, Jackson 3; Java 21), Gradle, MySQL 8, Flyway, Spring Security. The API contract is
`packages/api/openapi.yaml`; every route lives under `/api/v1`.

Request parsing is kept as it was on Spring Boot 3 (#81): `application.yml` turns off Jackson 3's
`fail-on-trailing-tokens` (so `/sync` and `/auth/*` still accept content after the JSON body; `/ai/*` refuses it in
`AiController`) and keeps the nesting limit at Jackson 2's 1000 instead of Jackson 3's 500. A duplicate key in an
`/auth/*` body takes the last value (202); Boot 3 answered 500, a bug, pinned in `AuthControllerTest`.

## Status (M0)

- `GET /api/v1/health` is public (200 `{status}`, 503 `Error` when the database is unreachable).
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
- Mail goes through the `MailSender` interface. Outside the dev profile `SmtpMailSender` delivers the code over SMTP
  (staging runs this too, with real SMTP settings; only local development uses the dev profile; settings from the environment only; the app refuses to start without `SMTP_HOST` and `SMTP_FROM`). With
  `SPRING_PROFILES_ACTIVE=dev`, `LoggingMailSender` is used instead and logs only that a code was issued, never the
  code or the address. Neither sender logs the code or address; a failed send is logged by exception class only.
- SMTP supports STARTTLS on submission ports such as 587. Implicit TLS (port 465) is out of scope for now.
- CORS: only the origins in `CORS_ALLOWED_ORIGINS` may call the API from a browser (exact match, no `*`), with the methods GET, POST and DELETE,
  `Authorization`, `Content-Type`, `Accept` and `If-None-Match` request headers, `Retry-After` and `ETag` exposed to the page, and no credentials (auth is a bearer header, not a cookie).
  Empty means every cross-origin call is refused.
- Flyway: `V1__baseline.sql` (`users`, `auth_identities`, `refresh_tokens`), `V2__email_sign_in_codes.sql`, `V3__email_verify_failures.sql`, `V4__sync_tables.sql` (the 16 sync tables, `sync_state`, `sync_conflicts`), `V5__ai_usage.sql`, `V6__ai_spend_monthly.sql`, `V7__refresh_token_replaces.sql`, `V8__sync_state_records.sql` (the per-account record counter).
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
- Account rights (#192), package `account`:
  - `GET /me/export`: one JSON document (`format_version` 1, `exported_at`, `user`, `tables` with an array for each of
    the 16 sync tables, tombstones included, and `conflict_log`, oldest first, with `loser` and `winner_version`).
    One read-only transaction. `Cache-Control: no-store` and a `Content-Disposition` file name with the UTC date.
    Limited to 5 per hour per user and 20 per hour per IP (`app.rate-limit.export-per-user`, `export-per-ip`);
    429 `rate_limited` with `Retry-After`. Credentials (tokens, codes) are not included. Not compressed by the app.
  - `DELETE /me`: one transaction removes the user's email-keyed rows (`email_sign_in_codes`, `email_verify_failures`
    for the account's addresses) and the `users` row; every user-owned table cascades from it (`ON DELETE CASCADE`),
    so a table added later with that foreign key is covered. 204, and 204 again on a repeat. Logs user id and time only.
  - `JwtAuthFilter` does an uncached primary-key lookup on `users` for every authenticated request, so an access
    token issued before the deletion gets 401 `unauthorized` everywhere except `DELETE /me`. Ids are never reused,
    so no denylist is needed. Cost: one indexed query per request. A database error in that lookup is 503
    `unavailable`, never 401. The sync transaction starts with `SELECT ... FROM users ... FOR SHARE`, so a
    concurrent `DELETE /me` waits for it, and a sync after the delete is 401 (never a foreign-key 500).
- AI (#232, contract 0.1.6), package `ai`:
  - `GET /ai/status`: which features are on and the user's daily quota (`no-store`; only the per-IP limit applies).
  - Every feature is off by default. A feature is on only while its flag is set (`AI_DESCRIBE_MEAL_ENABLED`,
    `AI_ASK_WHY_ENABLED`, `AI_WEEKLY_SUMMARY_ENABLED`, `AI_SUGGEST_TAGS_ENABLED`) and `AI_MONTHLY_BUDGET_TOKENS` is positive and not yet used up
    by the tokens recorded in `ai_spend_monthly` for the UTC month (0, the default, keeps everything off). The budget is a soft
    cap: it is read before each call, so calls already with the provider when it is reached can overshoot slightly.
    The flags and the budget are environment variables read at start: flipping one means restarting the container
    with the new value (no rebuild or redeploy of the image); requests already with the provider finish first only
    if the restart is graceful. A switched-off
    endpoint answers 503 `feature_disabled` and counts nothing.
  - Daily quota: `AI_DAILY_LIMIT` (default 10) per user per UTC day, shared by the three endpoints. `AiQuotaService`
    reserves a unit inside a transaction that locks the user's `users` row (so concurrent calls cannot overrun) and
    releases it if the call fails. At the limit: 429 `quota_exceeded` with `quota` and `Retry-After` until 00:00Z.
  - `ai_usage` (V5): user id, UTC day, feature, call count, token counts. No text, ever. Cascades on user delete;
    not part of the export.
  - `ai_spend_monthly` (V6): one token total per UTC month, no user id, day or feature, so deleting an account cannot
    refund its spend to the monthly budget. A total that names nobody is not personal data, so `DELETE /me` leaves it
    and the export omits it (`AccountRightsIT` lists it as the one table without an owner column, on purpose).
    V6 backfills it from `ai_usage` once. Rolling back to an image without V6 and then forward again under-counts: spend
    recorded in between is only in `ai_usage`, not in the ledger (and is lost from it if accounts were deleted).
  - Limits: `app.rate-limit.ai-per-user` (5 per minute, the four POSTs) and `ai-per-ip` (60 per minute, all four).
  - `POST /ai/describe-meal`, `/ai/ask-why`, `/ai/weekly-summary`, `/ai/suggest-tags` (contract 0.1.11). Order: token (401), per-IP then per-user limit (429
    `rate_limited`, counted even for 400s), switch (503 `feature_disabled`), validation against the contract schema
    (400, details name the field and keyword, never the value or a submitted key; trailing JSON and duplicate keys are 400), quota reserve (429 `quota_exceeded`), provider.
    The answer is 503 `unavailable` when the provider call fails or times out (no billed response): the unit is released. If the provider answered, it was billed: its tokens are recorded (they also stay in the monthly spend ledger after the account is deleted) and, if the reply has no text or fails the check, the answer is still 503 but the unit stays used. The AI error text in the contract is being updated to match.
  - While `StubAiProvider` is the active provider (`AiProvider.isStub()`), every feature is off whatever the flags say:
    `/ai/status` reports false and the endpoints answer 503 `feature_disabled`, so canned text never reaches users.
    A real provider bean replaces the stub and turns that off.
    `AiProviderConfig` is an auto-configuration (listed in `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`)
    so its `@ConditionalOnMissingBean(AiProvider.class)` is evaluated after every other bean is known.
  - Provider: `AiProvider` is the one seam; `StubAiProvider` (canned replies, no network, no key, no SDK) is the only
    implementation until one is chosen (#200). To add a real one, write a class implementing `AiProvider` (leave
    `isStub()` false) and make it a bean (`@Component` or a `@Bean` method); the stub then backs off and the four
    flags decide per feature. Do not also keep the stub as a second bean. No SDK or key is in the repo. A real one must use the cheapest suitable (small text) model, set
    timeouts, read its key from the environment only, and send only the prompt strings (`AiPrompts`): user text sits
    between `<<<` and `>>>` markers carrying a random per-request token (so no text can close them), after Unicode
    format, bidi, zero-width and control characters are stripped, and the instructions say it is data.
  - Replies (`AiReplies`) are parsed as data and validated against `DescribeMealResponse`, `AskWhyResponse` and
    `WeeklySummaryResponse` from the contract itself. Describe a meal drops items with non-finite or out-of-range
    numbers and keeps only the six contract fields of an item; Ask why nulls an unknown `card_id` and refuses `{` or `}` in the answer; Weekly summary sends any exercise
    that is not a catalogue id as `custom exercise`. Suggest tags (the typed exercise name goes to the model as delimited data, and is never logged) repairs the reply instead of failing it: unknown muscles dropped, first 3 of `primary` and `secondary`, `machine` for an unknown equipment, 2 for a difficulty outside 1 to 3, `pattern` over 50 characters becomes an empty string, `joints` capped at 20 items of at most 50 characters. No main muscle left is still 200 with an empty `primary` (the unit is kept); only an unparseable reply is 503 `unavailable`.
  - Content: Gradle copies every `content/*.json` into the jar under `/content` (`processResources`; the Dockerfile
    copies them too, and the build fails if `cards.json` or `exercises.json` is missing). Ask why sends every
    card with conditional blocks `{?x}..{/x}` dropped (else branch kept) and bare `{x}` replaced by a neutral phrase.
  - Cache: per user, in memory, Caffeine, 12 hours, keyed by user id and a hash of the normalised request. A cached
    answer still counts against the quota; failures are never cached.
  - Logs: one line per call with user id, feature, status and duration. Bodies, prompts and replies are never logged.
- Not yet: the foods endpoint.

## Content bundles

`GET /content/manifest` and `GET /content/{bundle}` (public, package `content`) serve every `content/*.json` byte for
byte: no allow-list, so a new file is a new bundle. `ContentBundles` computes each bundle's SHA-256, size and
`schema_version` once at startup from the exact bytes. The manifest is sorted by name; its ETag is the SHA-256 of its
body. A bundle's ETag is its SHA-256 in double quotes (strong). `If-None-Match` is compared weakly and accepts a list
and `*`; a value over 1024 characters or one that does not parse is ignored (200). A 304 carries `ETag`,
`Cache-Control` and `Vary: Accept-Encoding`. `Cache-Control` is `public, max-age=300` for the manifest and
`public, no-cache` for a bundle. The responses are not compressed by the app (a proxy may). A malformed name is 400
`invalid_request`, a well-formed name not in the manifest is 404 `not_found`. Requests use the shared public per-IP rate
limit. Nothing is logged.

`updated_at` is the committer date of each file (`git log -1 --format=%cI -- content/<name>.json`, UTC) on a
full-history checkout of `main`. The app reads it from `CONTENT_UPDATED_AT`, a comma-separated list of `name=timestamp`
with one entry per `content/*.json`. It refuses to start if a bundle has no value, and never falls back to the build
time. `scripts/content-updated-at.sh` prints the value (it fails on a shallow clone or a file with no commit):

```sh
CONTENT_UPDATED_AT="$(backend/scripts/content-updated-at.sh)" ./gradlew bootRun
```

`./gradlew test` sets a fixed value for every file in `content/` itself.

## Sync

Package `app.plateandbar.api.sync`. The user is always the token's principal; no body field names a user.

- **Storage.** One table per contract `SyncTable` (`profiles`, `food_logs`, ... `settings`), all the same shape:
  `user_id, id, version, updated_at, deleted_at, seq, data JSON`, primary key `(user_id, id)`. `data` holds the
  record's other fields, so the engine is generic over tables. Foreign key to `users` with `ON DELETE CASCADE`.
  `sync_state` holds one row per user with the change counter `seq`; `sync_conflicts` is the conflict log.
  The conflict log is bounded per user (`SYNC_CONFLICT_LOG_MAX_PER_USER`, default 1000; `SYNC_CONFLICT_LOG_RETENTION_DAYS`,
  default 90; both must be at least 1 or the app refuses to start). Pruning happens only when a later sync logs a
  conflict: then entries older than the retention and all but the newest ones are deleted. An account that stops
  conflicting is not pruned, and its expired entries stay until then. So `GET /me/export`'s `conflict_log` holds at most
  the cap. Schema `maxLength`/`maxItems` limits are not enforced yet (#353). Deletes are soft (`deleted_at`).
- **Account record cap** (#349, contract 0.1.16). `SYNC_MAX_RECORDS_PER_ACCOUNT` (`app.sync.max-records-per-account`) is
  the most records one account may store across the 16 tables, tombstones included (the conflict log does not count).
  **Unset, empty or 0 means no cap, and that is the default** until the app's `account_full` handling has merged (today's
  app reads any 413 as a too-large body and splits the batch); then set it (the contract suggests 200000). A negative or
  non-numeric value stops the app at start. A push is refused with 413 `account_full` and `record_cap`
  `{limit, stored, new_records}` only when it has at least one new record and `stored + new > limit`. New means the
  account stores no row with that id in that table (whatever `version` was sent); edits, deletes, retries, a natural-key
  record whose key is already stored and pull-only requests are never refused, even when `stored` is over a lowered
  limit. A refused request applies nothing, pulls nothing, leaves the cursor and the conflict log alone (the transaction
  rolls back). Checks run in the contract's order: body size, token, rate limit, validation including `natural_key_id`
  (400), then the cap. `stored` is `sync_state.records`, a per-user counter (V8, backfilled from the 16 tables) that
  the sync transaction raises by the number of new ids under the same `FOR UPDATE` lock that serialises the account's
  syncs, so two devices cannot overrun the cap and no push counts 16 tables. It is kept even while the cap is off, so
  turning the cap on needs no recount. The only log line is the refusal: user id and the three counts.
- **Validation.** The body is read with a size cap (`app.sync.max-body-bytes`, env `SYNC_MAX_BODY_BYTES`, default
  2 MB; larger is 400 `invalid_request` with detail `too_large`), the records are counted against the 500 cap before
  anything else (detail `too_many_records`), then the body is validated against the schemas in the contract
  (`SyncRequestValidator`, networknt json-schema-validator 3, which runs on Jackson 3). The validator reads the one
  `packages/api/openapi.yaml`: Gradle's `processResources` copies it onto the classpath, so there is no second
  copy to drift. Any problem is 400 `invalid_request` for the whole request with `details` naming the field and the
  failed keyword, never the value. Beyond the schema: no id twice in one request, ids lower-cased (stored, and echoed
  lower-cased in `applied`, `conflicts` and pulls, as the contract says), and natural-key tables (`profiles`, `settings`, `day_notes`, `workouts`, `weights`,
  `measurements`, `lift_stats`, `swaps`) must use the UUIDv5 of `<table>:<key>` in the user's namespace.
- **Unknown record fields are dropped**, deliberately: the deploy-order rule is that the backend always ships a
  contract version before any app sends the fields it adds, so a field the server does not know is never a field
  an app depends on.
- **Locking.** Each sync locks the user's `sync_state` row (`SELECT ... FOR UPDATE`), so two devices of one user sync
  one after the other and change numbers are assigned in commit order. The row is created with an upsert
  (`INSERT ... ON DUPLICATE KEY UPDATE`) that takes the exclusive lock at once, so two first syncs of one user queue
  rather than deadlock. Different users' syncs run in parallel; they share only the database's own row-level locks.
- **Push**, per record with the version `v` the device last saw: no stored record means it is stored as version 1;
  `v` equal to the stored version stores `version + 1`; otherwise a conflict. If the content apart from `version`
  and `updated_at` equals the stored record (and both or neither are deleted) it is a retry: `server_won`, nothing
  written, nothing logged. Otherwise the later `updated_at` wins and a tie goes to the server; the loser is
  written to `sync_conflicts` with its version, `updated_at`, `deleted_at` and fields.
- **Clock.** `updated_at` and `deleted_at` more than 5 minutes ahead of the server clock are stored as server time.
- **Pull.** Records with `seq` greater than the cursor, oldest change first, at most 500 per response with
  `has_more`. The cursor is `c_` plus the user's change number as 16 hex digits. A request's own writes are not
  echoed back in the same response, but when `has_more` is true a device's own earlier writes can come back on a
  later page (same version and content as it already holds, so adopting them is harmless). A first sync (cursor null) leaves tombstones out. A cursor this user has
  never been given (ahead of their counter) or in any other shape is 400.
- A token for an account that no longer exists is 401 `unauthorized`.
- Nothing in this package logs. `application.yml` pins Spring's body and SQL-parameter loggers to INFO because
  they print whole records at DEBUG or TRACE.

## Run

Needs JDK 21 and a MySQL 8 database.

```sh
cd backend
CONTENT_UPDATED_AT="$(scripts/content-updated-at.sh)" DB_URL=jdbc:mysql://localhost:3306/plateandbar DB_USER=plateandbar DB_PASSWORD=... JWT_SIGNING_KEY=... GOOGLE_CLIENT_IDS=... ./gradlew bootRun
curl localhost:8080/api/v1/health
```

Docker (multi-stage, works on arm64 and amd64). Build from the repository root, because the API reads
`packages/api/openapi.yaml` and `content/*.json`; `backend/Dockerfile.dockerignore` limits the context to `backend/` and
those files. The build argument `CONTENT_UPDATED_AT` is required (compute it on the host from a full-history checkout,
because `.git` is not in the context); the build fails without it or if a content file has no value:

```sh
docker build -f backend/Dockerfile --build-arg CONTENT_UPDATED_AT="$(backend/scripts/content-updated-at.sh)" -t plateandbar-api .
docker run --rm -p 8080:8080 -e DB_URL=... -e DB_USER=... -e DB_PASSWORD=... \
  -e JWT_SIGNING_KEY=... -e GOOGLE_CLIENT_IDS=... plateandbar-api
```

## Test

```sh
cd backend
./gradlew build      # compile, all tests, bootJar (the command CI will run; the workflow lands in PR #38)
./gradlew test
```

`HealthMigrationIT`, `AuthFlowIT`, `RateLimitIT` and the sync ITs (`SyncEngineIT`, `SyncIsolationIT`, `SyncContractIT`, `SyncMigrationIT`, `SyncRecordCapIT`, `SyncRecordCountIT`) use Testcontainers to start MySQL 8, so Docker must be running.
`SmtpMailSenderTest` sends to an in-process GreenMail server (Apache-2.0); `CorsTest` and `CorsDefaultTest` cover preflight allowed and denied.
`HealthControllerTest`, `AuthControllerTest`, `SyncControllerTest`, `JwtAuthFilterTest` and `RateLimitFilterTest` are WebMvc tests;
`ContentBundlesTest` (loads `content-hash.json`), `ContentControllerTest`, `ContentRealFilesTest` and `ContentRateLimitTest` (WebMvc), `UuidsTest` (loads `packages/api/test-vectors/sync-ids.json`), `JsonContentTest`, `CursorTest`, `JwtServiceTest`, `GoogleIdTokenVerifierTest`, `RateLimiterTest` and `ClientIpResolverTest` are plain unit tests. None of these need Docker. Gradle sets throwaway
`JWT_SIGNING_KEY`, `GOOGLE_CLIENT_IDS`, `SMTP_HOST` and `SMTP_FROM` for tests; `CONTENT_UPDATED_AT` has one `name=timestamp` entry per file in `content/` (the build sets it for Gradle; in an IDE set it, for example to `"$(backend/scripts/content-updated-at.sh)"`). Run tests from an IDE with the same variables.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_URL` | `jdbc:mysql://localhost:3306/plateandbar` | JDBC URL |
| `DB_USER` | `plateandbar` | Database user |
| `DB_PASSWORD` | empty | Database password |
| `CONTENT_UPDATED_AT` | none, required | `name=timestamp,...` for every `content/*.json`; set it to `"$(backend/scripts/content-updated-at.sh)"`. The app refuses to start without it. Deploys compute it on a full-history checkout of `main` (HEAD of that checkout) and pass it as the Docker build arg |
| `PORT` | `8080` | HTTP port |
| `JWT_SIGNING_KEY` | none, required | HS256 key for access tokens and code digests, at least 32 bytes. The app refuses to start without it |
| `SYNC_MAX_BODY_BYTES` | `2097152` | Largest accepted request body on any `/api` endpoint, including `/auth/*` (a guard filter, 400 `invalid_request` detail `too_large`; a chunked body is cut off once it passes the limit), and the `POST /sync` cap. The guard runs before security, CORS and rate limiting, so a body declared over the limit gets 400 `too_large` even before a 401 or 429. Multipart is disabled (no endpoint takes it). `/ai/*` bodies are read up to 16,384 bytes (bytes, not characters); a longer one is 400 `invalid_request` with issue `too_large`, field empty, in the validation step (after the feature switch) |
| `SMTP_HOST` | none, required outside the dev profile | SMTP server host |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER`, `SMTP_PASSWORD` | empty | SMTP credentials; leave `SMTP_USER` empty for no authentication |
| `SMTP_FROM` | none, required outside the dev profile | Sender address of sign-in mails |
| `SMTP_STARTTLS` | `true` | Require STARTTLS; set `false` only for a local test server. The app refuses to start if `SMTP_USER` or `SMTP_PASSWORD` is set while this is `false` |
| `SYNC_MAX_RECORDS_PER_ACCOUNT` | empty (no cap) | Most records one account may store; over it, a push with new records is 413 `account_full`. Empty or `0` is off; see "Sync" |
| `CORS_ALLOWED_ORIGINS` | empty | Comma-separated web app origins, e.g. `https://app.example.com` |
| `SPRING_PROFILES_ACTIVE` | empty | `dev` swaps SMTP for the logging mail sender |
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
with a port such as `1.2.3.4:80`), falls back to the proxy's address. Hostnames are never resolved. Staging sits behind a reverse proxy (Caddy, #36), so `trusted-proxies` must be set there.

Deploy checklist: set `APP_RATELIMIT_TRUSTEDPROXIES` on the API service to the address or network of the proxy that
connects directly to the API, that is Caddy's own address or the Docker network range it connects from (for example
`APP_RATELIMIT_TRUSTEDPROXIES=172.18.0.0/16`). It is not Caddy's `trusted_proxies` setting, which lists the proxies in
front of Caddy. If a CDN or another proxy ever sits in front of Caddy, its ranges must be added to
`APP_RATELIMIT_TRUSTEDPROXIES` too, because the resolver stops at the first address that is not trusted (there is no CDN
today). If it is left empty behind a proxy, every client shares the proxy's buckets; the worst effect is the
10-per-hour `/auth/email/start` cap, which one script could use up so nobody can request a sign-in code. The app logs one
ERROR line (no address, no header value) the first time it sees a private or loopback peer sending `X-Forwarded-For`
with the list empty, once per resolver instance (a singleton, so once per process). Local development, where nothing
sends that header, is unaffected. IPv6 clients are keyed by their /64. The in-memory
buckets are per process: run one instance, or move them to a shared store before scaling out.

### TLS and HSTS

TLS ends at Caddy, which sets `Strict-Transport-Security` for the API host (`infra/caddy/Caddyfile.api`). The API
does not: `server.forward-headers-strategy` is `none` on purpose. Enabling it (`native`) would bypass the
trusted-proxies list, because the container would trust forwarded headers from private-range proxies. The client IP is
handled only by the trusted-proxy rule above. HSTS belongs at Caddy (`infra/caddy/Caddyfile.api` sets it); the app sends none. `GET /api/v1/health` returns exactly `{status}`: contract 0.1.15 removed `version` (#352), so the app no longer reads `APP_VERSION` and a version string is not exposed to unauthenticated callers.

Secrets come from the environment only. Logs must never contain food, weight, health answers or tokens.

## Layout

Package by feature under `app.plateandbar.api`: `health`, `auth`, `common` (shared error handling);
later `sync`, `foods`, `content`, `ai`, `account`.
