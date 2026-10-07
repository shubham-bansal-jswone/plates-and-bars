# ADR 002: Food data sources (no IFCT or INDB)

- Status: Accepted
- Date: 2026-10-08

## Context

Most users eat Indian home food, which global databases cover poorly. The obvious Indian sources, IFCT (Indian Food Composition Tables) and INDB, have not been cleared for use in this app, and the launch checklist requires that none of their data is present. Food values are also the base of every calorie and macro number the app shows, so where each value came from must be traceable.

## Decision

- **No IFCT or INDB data anywhere**: not in `content/`, the database, the app bundle, recipes, kitchen-test defaults or tests.
- Food values come only from:
  1. USDA FoodData Central (SR Legacy / SR28), public domain, for raw ingredients and plain foods.
  2. Values derived from public FSSAI standards, for dairy and similar standardised products (paneer, curd, milk).
  3. Our own recipes, calculated from (1) and (2) raw ingredients by weight.
  4. Our own kitchen tests: dishes weighed while cooking.
- Every food row records its source and licence (`foods` and `food_sources` tables; `source` on each food in the API), and the app has an attribution screen.
- Carbohydrate is always total carbohydrate including fibre; fibre is stored and shown separately.
- Hindi and everyday names are aliases on our own rows, not imported data.

## Consequences

- Some Indian dishes need recipes or kitchen tests before they appear, so the initial list is smaller and grows with testing.
- A CI check fails any change that mentions IFCT or INDB as a source in `content/`.
- Values may differ a little from figures users see elsewhere; source per row lets us explain and correct them.
- Adding a new source (for example Open Food Facts in v1.1) needs its own licence check and an update to this ADR.
