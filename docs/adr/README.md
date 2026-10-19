# Architecture decision records

Short records of decisions that shape the whole project, in Context / Decision / Consequences form. Add a new numbered file for a new decision; to change one, write a new ADR that supersedes it rather than editing the old one. Wording corrections and omissions that change no decision may be fixed in place, with a dated "Amended" note under Status.

| ADR | Title | Status |
| --- | --- | --- |
| [001](001-stack-and-offline-first-sync.md) | Stack (Expo, Spring Boot, MySQL) and offline-first sync | Accepted |
| [002](002-food-data-sources.md) | Food data sources: no IFCT or INDB | Superseded by 005 |
| [003](003-auth.md) | Auth: Google and email code sign-in, JWT with rotating refresh tokens | Accepted; web refresh-token storage superseded by 006 |
| [004](004-account-identity-and-device-ownership.md) | Account identity and device ownership: identities keyed by Google sub, one account per verified email, unsynced queue blocks account switch | Accepted |
| [005](005-food-data-sources-own-estimates.md) | Food data sources (adds own estimates): supersedes 002, no IFCT or INDB | Accepted |
| [006](006-web-refresh-token-cookie.md) | Web refresh token in an httpOnly, SameSite=Strict cookie, access token in memory; native unchanged (supersedes 003 in part) | Accepted |
| [007](007-sync-conflict-replaced-record.md) | Sync conflicts return the replaced record on `client_won`, so the app can merge and re-push (adds to 001) | Accepted |
| [008](008-ai-image-calls-and-privacy.md) | AI image calls (meal photo, recipe import, form check): base64 in JSON, JPEG or PNG, re-encoded on the server to strip EXIF, never stored or logged | Accepted |
| [009](009-open-food-facts-barcode-lookup.md) | Open Food Facts for barcode lookups: per-barcode on-demand cache, no images, attribution per row (supersedes 005 on adding a source only) | Accepted |
| [010](010-label-scan-on-device-ocr.md) | Label scanning: on-device OCR with Tesseract 5, mandatory review, no server call, flag off until a bake-off passes | Accepted |
