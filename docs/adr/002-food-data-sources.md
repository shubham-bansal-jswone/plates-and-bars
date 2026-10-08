# ADR 002: Food data sources (no IFCT or INDB)

- Status: Superseded by [ADR 005](005-food-data-sources-own-estimates.md)
- Date: 2026-10-08
- Amended 2026-10-08: corrected in place the same day it merged (issue #5). Recorded the packaged-food source the prototype already used when this ADR was written (an omission, not a new source), replaced an unsupported licensing claim with its actual source, and aligned the wording on adding a source with the ADR index.

## Context

Most users eat Indian home food, which global databases cover poorly. The obvious Indian sources are IFCT (Indian Food Composition Tables) and INDB. The development plan rules them out, and its launch checklist requires "No IFCT or INDB data anywhere in the app or database"; this ADR records that prohibition rather than a licensing analysis of its own. Food values are also the base of every calorie and macro number the app shows, so where each value came from must be traceable.

## Decision

- **No IFCT or INDB data anywhere**: not in `content/`, the database, the app bundle, recipes, kitchen-test defaults or tests.
- Food values come only from:
  1. USDA FoodData Central (SR Legacy / SR28), public domain, for raw ingredients and plain foods.
  2. Values derived from public FSSAI standards, for dairy and similar standardised products (paneer, curd, milk).
  3. Our own recipes, calculated from (1) and (2) raw ingredients by weight.
  4. Our own kitchen tests: dishes weighed while cooking.
  5. Typical label values for packaged foods (in the prototype: whey protein, Greek yogurt, makhana): nutrition facts read by us from manufacturers' product labels, recorded as typical values across common brands rather than as one brand's product. No label database is copied. Source code `label_typical` in the API.
- Every food row records its source and licence (`foods` and `food_sources` tables; `source` on each food in the API), and the app has an attribution screen.
- Carbohydrate is always total carbohydrate including fibre; fibre is stored and shown separately.
- Hindi and everyday names are aliases on our own rows, not imported data.

## Consequences

- Some Indian dishes need recipes or kitchen tests before they appear, so the initial list is smaller and grows with testing.
- A CI check fails any change that mentions IFCT or INDB as a source in `content/`.
- Values may differ a little from figures users see elsewhere; source per row lets us explain and correct them.
- Adding a new source (for example Open Food Facts in v1.1) needs its own licence check and a new ADR that supersedes this one.
