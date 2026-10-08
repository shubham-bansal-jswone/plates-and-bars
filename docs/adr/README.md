# Architecture decision records

Short records of decisions that shape the whole project, in Context / Decision / Consequences form. Add a new numbered file for a new decision; to change one, write a new ADR that supersedes it rather than editing the old one. Wording corrections and omissions that change no decision may be fixed in place, with a dated "Amended" note under Status.

| ADR | Title | Status |
| --- | --- | --- |
| [001](001-stack-and-offline-first-sync.md) | Stack (Expo, Spring Boot, MySQL) and offline-first sync | Accepted |
| [002](002-food-data-sources.md) | Food data sources: no IFCT or INDB | Superseded by 005 |
| [003](003-auth.md) | Auth: Google and email code sign-in, JWT with rotating refresh tokens | Accepted |
| [004](004-account-identity-and-device-ownership.md) | Account identity and device ownership: identities keyed by Google sub, one account per verified email, unsynced queue blocks account switch | Accepted |
| [005](005-food-data-sources-own-estimates.md) | Food data sources (adds own estimates): supersedes 002, no IFCT or INDB | Accepted |
