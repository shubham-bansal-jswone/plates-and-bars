# ADR 009: Open Food Facts for barcode lookups (supersedes ADR 005 on this point only)

- Status: Accepted
- Date: 2026-10-18
- Supersedes: [ADR 005](005-food-data-sources-own-estimates.md), only its closing consequence that adding a source such as Open Food Facts needs its own licence check and ADR. ADR 005's source list, its "no IFCT or INDB" rule and the CI check stand unchanged; this ADR adds one source to that list.
- Decided on #944 by the coordinator under the owner's delegation; contract 0.2.0. The owner still has to confirm the share-alike reading below (open item O3 on #944). This is a reading of the licences, not legal advice.

## Context

v1.1 adds barcode scan (#944): the user scans a packaged food and the app proposes a food to review. Our own food data cannot cover packaged products. Open Food Facts (OFF) is a community database of them and the obvious source. ADR 005 allows only six sources and says a new one needs a licence check and an ADR.

OFF's terms (read 2026-10-18 on world.openfoodfacts.org/terms-of-use):
- The database is under the Open Database Licence (ODbL 1.0) and its individual contents under the Database Contents Licence (DbCL 1.0). Re-users must credit OFF, name the licence, link to OFF or the product page, and share derivative databases under the same terms.
- Product images are CC BY-SA 3.0.
- The data is community-entered, may contain errors and must not be used for medical purposes.
- The API asks for a descriptive `User-Agent` with a contact, and caps product reads at 15 per minute per IP.

The IFCT and INDB ban is unrelated and unchanged: OFF rows are not IFCT or INDB data, but `content/` must still hold none of either.

## Decision

- Open Food Facts becomes a seventh food source, code `open_food_facts`, licence "ODbL 1.0 / DbCL 1.0". It appears only on `GET /foods/barcode/{code}`; `GET /foods` and `content/` never carry it.
- **Per-barcode, on demand only.** The server fetches one product when a user scans that barcode and keeps the answer in a per-barcode cache table with a time to live (30 days for a hit, 24 hours for a miss). No list, search, export or bulk endpoint over that cache, no import of an OFF dump, nothing copied into `content/`, the repo or a seed file.
- **No images.** The server asks only for text and number fields and returns a whitelist of them; the app never fetches or shows OFF images, so CC BY-SA 3.0 is not engaged.
- **Attribution on every scanned row.** Each response carries `source` (name, licence, link to the product page on openfoodfacts.org). The app shows "Open Food Facts (ODbL)" with that link on every scanned food, and lists OFF on the About screen and the site licences page. The licences page also says cached product facts stay under ODbL/DbCL with OFF credit.
- **A saved food is the user's own record.** It becomes a normal `UserFood` (private, synced to that user only, `origin: custom`) with an optional `barcode`; it is not a published database. Nothing is written back to OFF.
- **Not medical data.** The app shows the data as community-entered and to be checked against the pack; the existing not-medical-advice text applies.
- **Proxy, not direct calls.** The app never calls OFF. The server does, with a fixed host, our `User-Agent` and contact, a shared upstream limit and no logging of the barcode, so OFF never sees the user's IP, name or account.
- Retention of the cache is stated on the privacy page.

## Consequences

- The contract gains `GET /foods/barcode/{code}`, `OffProduct`, `FoodSource.code` `open_food_facts`, the error codes `invalid_barcode`, `upstream_unavailable` and `upstream_busy`, and the optional `UserFood.barcode`. All are additive.
- The CI check against IFCT and INDB is unaffected. A separate check that `content/` holds no OFF data may be added later; today nothing writes OFF data there.
- Scanning needs a connection. Offline, repeat scans of a saved barcode still resolve locally; new ones fall back to manual entry.
- The server's shared limit on calls to OFF caps how many new barcodes the whole user base can look up per minute; beyond it users get a "busy" message. If scanning grows, revisit with OFF's own bulk export, which would be a new decision under ODbL share-alike.
- Open items for the owner (#944): fill in OFF's API usage form and pick the contact address, ask OFF how a proxy IP is rate-limited, and confirm that the per-barcode, expiring, non-listable cache keeps us clear of ODbL share-alike.
- ADR 002 and 005 wording that says Open Food Facts needs a new ADR is satisfied by this one.
