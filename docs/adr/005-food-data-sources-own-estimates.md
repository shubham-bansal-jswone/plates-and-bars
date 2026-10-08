# ADR 005: Food data sources (adds own estimates)

- Status: Accepted
- Date: 2026-10-08
- Supersedes: [ADR 002](002-food-data-sources.md)
- Decided under Shubham's delegation (issue #164); he can overturn it.

## Context

ADR 002 limits food values to five sources and bans IFCT and INDB. The eating-out table (`content/eatout.json`, #160, #162) holds restaurant dishes whose values are our own rough estimates: they were never weighed in a kitchen test or cooked to one of our recipes. None of the five sources describes them, so they were filed under `own_recipe`, which overstates how they were made. ADR 002 says a new source needs a new ADR that supersedes it; this is that ADR. Everything else in ADR 002 is restated here unchanged.

## Decision

- **No IFCT or INDB data anywhere**: not in `content/`, the database, the app bundle, recipes, kitchen-test defaults or tests.
- Food values come only from:
  1. USDA FoodData Central (SR Legacy / SR28), public domain, for raw ingredients and plain foods.
  2. Values derived from public FSSAI standards, for dairy and similar standardised products (paneer, curd, milk).
  3. Our own recipes, calculated from (1) and (2) raw ingredients by weight.
  4. Our own kitchen tests: dishes weighed while cooking.
  5. Typical label values for packaged foods (in the prototype: whey protein, Greek yogurt, makhana): nutrition facts read by us from manufacturers' product labels, recorded as typical values across common brands rather than as one brand's product. No label database is copied. Source code `label_typical` in the API.
  6. Our own estimates: rough values we estimate ourselves for dishes that were never weighed or cooked to a recipe, such as restaurant dishes (`content/eatout.json`). These are our own values, not imported data, so no third-party licence applies; they must still not be taken from IFCT or INDB. Source code `own_estimate` in the API.
- Every food row records its source and licence (`foods` and `food_sources` tables; `source` on each food in the API), and the app has an attribution screen.
- Carbohydrate is always total carbohydrate including fibre; fibre is stored and shown separately.
- Hindi and everyday names are aliases on our own rows, not imported data.

## Consequences

- Some Indian dishes need recipes or kitchen tests before they appear, so the initial list is smaller and grows with testing.
- Restaurant dishes can be listed before they are tested, and their source tells the user they are rough estimates. A row moves to `own_recipe` or `kitchen_test` once it is cooked to a recipe or weighed.
- A CI check fails any change that mentions IFCT or INDB as a source in `content/`.
- Values may differ a little from figures users see elsewhere; source per row lets us explain and correct them.
- Adding a new source (for example Open Food Facts in v1.1) needs its own licence check and a new ADR that supersedes this one.
