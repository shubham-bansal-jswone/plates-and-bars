# AGENTS.md

Rules for every agent working on Plate & Bar. Read this, the issue, the contract (`packages/api/openapi.yaml`) and the relevant spec section (`docs/spec/PROTOTYPE_SPEC.md`) before writing code. Shubham reviews and merges every change; nothing merges without a human.

## Lanes

| Agent | Owns | Never touches |
| --- | --- | --- |
| Contract | `packages/api` (OpenAPI spec), `docs/adr` | Implementation code |
| Core logic | `packages/core`: ports the spec's rules with tests | UI, backend |
| Backend | `backend/`: endpoints, migrations, sync, AI proxy | App, content |
| App | `apps/mobile`: screens, offline store, sync client | Backend, rules (imports `core`) |
| Content | `content/`, `tools/`: exercises, cards, recipes, USDA import | Code outside `tools/` |
| Website | `apps/site` | Everything else |
| Infra | `infra/`, `.github/`, `.gitleaks.toml`: CI, Compose, staging, backups, Dependabot config | Application code |
| QA | `tests/e2e/`: Maestro and Playwright tests, bug reports | Fixes (files issues instead) |

`docs/` outside `docs/adr/` (this file, the plan, the spec and golden fixtures) is owned by Shubham; agents change it only when an issue labelled `docs` asks them to.

## Rules

- Read the issue, the contract and the spec before writing code.
- Before starting any work, run `git fetch origin` and base the work on the latest `origin/main`: new work starts in a fresh worktree from `origin/main` (`git worktree add <dir> -b <lane>/<name> origin/main`), and an existing branch gets `git merge origin/main` first (merge only, never rebase or force-push). Fetch again and merge again before every push and before review.
- Never commit secrets, change another agent's folder, or edit the contract outside a contract PR.
- Contract changes land first, alone, after review. Prefer additive changes; flag any breaking change in the PR title.
- Backend and app code are built against the merged `packages/api/openapi.yaml` on `main`, never against an open contract PR.
- Rules and numbers come from `packages/core` or `content/`, never re-typed in UI or backend code.
- Every new calculation gets a test with numbers checked against the spec and golden fixtures.
- Pull requests are small (under about 400 lines), pass CI, include tests and fill the PR checklist.
- Logs never contain food, weight, health answers or tokens.
- Unsure → ask in the issue; don't guess.

## Behaviour source of truth

- `docs/spec/PROTOTYPE_SPEC.md` and `docs/spec/golden/` are the spec of record for how the app behaves. Read the relevant section before writing code. The original HTML prototype is frozen at git tag `prototype-final` (commit f94c8e96) and is no longer maintained; the spec names its functions.
- Port logic into `packages/core`; don't redesign it. If something looks wrong, open an issue labelled `spec-question` instead of "fixing" it silently.
- Every ported rule needs a test that loads the matching file in `docs/spec/golden/` and reproduces it exactly (numbers rounded the same way).
- Food data: only USDA, FSSAI-derived values, typical label values for packaged foods, our own recipes, kitchen tests and own estimates (ADR 005). Never add IFCT or INDB data.
- Carbs everywhere are total carbohydrate including fibre.

## When the spec changes

1. A PR labelled `spec-change` edits `docs/spec/PROTOTYPE_SPEC.md` (dated entry at the top of section 0) and the matching `docs/spec/golden/` JSON together with the `packages/core` change. The review gate is the `spec-change` label plus a reviewer.
2. CI fails any golden test that no longer matches; the owning agent updates the port in a follow-up PR that references the `spec-change` PR.
3. Golden files are no longer generated; edit them in the `spec-change` PR only.
