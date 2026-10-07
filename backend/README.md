# Plate & Bar backend

Spring Boot 3 (Java 21), Gradle, MySQL 8, Flyway, Spring Security. The API contract is
`packages/api/openapi.yaml`; every route lives under `/api/v1`.

## Status (M0 skeleton)

- `GET /api/v1/health` is public (200 `{status, version}`, 503 `Error` when the database is unreachable).
- Every other route under `/api/v1` requires a bearer token. JWT validation is not wired yet (#33),
  so protected routes currently answer 401 `unauthorized`.
- Flyway `V1__baseline.sql` creates `users`, `auth_identities`, `refresh_tokens`.
- All errors use the contract's `Error` schema (`common/ApiExceptionHandler`).
- Not yet: rate limiting (429), sync tables (#28), auth endpoints (#33).

## Run

Needs JDK 21 and a MySQL 8 database.

```sh
cd backend
DB_URL=jdbc:mysql://localhost:3306/plateandbar DB_USER=plateandbar DB_PASSWORD=... ./gradlew bootRun
curl localhost:8080/api/v1/health
```

Docker (multi-stage, works on arm64 and amd64):

```sh
docker build -t plateandbar-api backend
docker run --rm -p 8080:8080 -e DB_URL=... -e DB_USER=... -e DB_PASSWORD=... plateandbar-api
```

## Test

```sh
cd backend
./gradlew build      # compile, all tests, bootJar (the command CI will run; the workflow lands in PR #38)
./gradlew test
```

`HealthMigrationIT` uses Testcontainers to start MySQL 8, so Docker must be running.
`HealthControllerTest` is a WebMvc test and needs no Docker.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_URL` | `jdbc:mysql://localhost:3306/plateandbar` | JDBC URL |
| `DB_USER` | `plateandbar` | Database user |
| `DB_PASSWORD` | empty | Database password |
| `PORT` | `8080` | HTTP port |
| `APP_VERSION` | `0.1.0` | Value returned as `version` by `/health` |

Secrets come from the environment only. Logs must never contain food, weight, health answers or tokens.

## Layout

Package by feature under `app.plateandbar.api`: `health`, `auth`, `common` (shared error handling);
later `sync`, `foods`, `content`, `ai`, `account`.
