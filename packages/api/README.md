# packages/api

The Plate & Bar API contract and the TypeScript client generated from it.

- `openapi.yaml`: the contract (OpenAPI 3.1, base path `/api/v1`). Backend and app both build against it.
- `client/schema.d.ts`: types generated from the spec by `openapi-typescript`. Do not edit by hand.
- `client/index.ts`: `createClient(baseUrl, getToken)`, a typed client on `openapi-fetch` that adds the bearer token to each request.
- `client/contract-guards.ts`: compile-time checks that `SyncChanges` and `ExportTables` each have exactly one key per `SyncTable` value; `npm run typecheck` fails on drift.
- `test-vectors/sync-ids.json`: shared vectors for natural-key sync ids (UUIDv5 of `<table>:<key>` in the user's namespace, see `POST /sync`). Backend and app tests load this file; `test-vectors/verify.mjs` checks it, and the natural-key ids in the `/sync` and `/me/export` examples, against an independent UUIDv5.
- `test-vectors/content-hash.json`: shared vectors for content bundle hashes (`sha256`, `size_bytes` and `ETag` of exact UTF-8 bytes, see the `content` tag). Backend and app tests load this file; `verify.mjs` checks it against SHA-256 and checks the `/content/*` examples (manifest sorted by name with no repeated name, ETag examples equal the example bundle's `sha256`). It also checks that every tag an operation uses is declared once under the top-level `tags`, and that every string, array and open object reachable from a sync record schema or a `POST /ai/*` request body has a `maxLength`, `maxItems` or `maxProperties` (enums, formats and consts count as bounds for strings; a pattern counts only when anchored at both ends with no `*`, `+` or `{n,}`). It then removes each bound from the AI request schemas one at a time and fails if the check does not notice.
- `test-vectors/blank-text.json`: the one "not blank" definition (#421): Unicode `White_Space` plus U+200B to U+200D, U+2060 and U+FEFF, as the `pattern` every must-not-be-blank field uses, with must-fail texts (NBSP-only, ZWSP-only, ...) and must-pass texts. Backend and app blank checks should load this file. `verify.mjs` checks that the listed fields use the pattern, that no pattern anywhere in the spec uses `\s`, `\S`, `\v`, `\h`, `\H`, `\R`, `\p{}` or `\P{}` (ECMA-262 and `java.util.regex` read them differently) or a lookbehind, and the vectors against the pattern with and without the `u` flag.

## Commands

Run from `packages/api/` (Node 20 or later):

```sh
npm install
npm run lint        # validate the spec (Redocly CLI, recommended rules)
npm run generate    # regenerate client/schema.d.ts from openapi.yaml
npm run typecheck   # type-check the client
npm run test-vectors  # verify test-vectors/sync-ids.json, content-hash.json and blank-text.json
npm run check       # all of the above, failing if schema.d.ts is out of date
```

Commit `openapi.yaml` and the regenerated `client/schema.d.ts` together.

## Using the client

```ts
import { createClient } from "@plate-and-bar/api";

const api = createClient("https://<host>/api/v1", () => secureStore.getAccessToken());
const { data, error } = await api.GET("/foods", { params: { query: { q: "dahi" } } });
```

## Changing the contract

- Contract changes land in their own PR, containing only `packages/api/` (and ADRs when relevant), reviewed before any implementation that depends on them.
- Prefer additive changes: new endpoints, new optional fields, new enum values the app can ignore.
- Any breaking change (removing or renaming a field or endpoint, tightening validation, changing a type or meaning) must say **BREAKING** in the PR title and bump the major part of `info.version` (or the minor part while it is `0.x`).
- Exception: tightening validation on a field no shipped client writes yet is a patch bump, not BREAKING, and the PR body must say so and why no client is affected.
- Only spec what the current milestone needs.
