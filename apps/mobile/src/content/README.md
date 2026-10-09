# Reading content bundles in screens

Server copies of the `content/*.json` bundles are fetched and stored by `refresh.ts`, chosen once at app start by `loadContent` (called from the database `onInit` in `app/_layout.tsx`) and applied on the NEXT launch. No hot-swap.

## Why readers are lazy

`SQLiteProvider` renders its children (the router and every screen) only after `onInit` has finished, so `loadContent` has always run before any screen code. What broke the first design was module-level constants such as `export const catalogFoods = foods.foods`, evaluated when the module is imported, which can be before the database init. So: never build anything from a content import at module level. Build it in a getter.

## The pattern (copy `src/food/catalog.ts`)

1. Keep the static JSON import. It is the synchronous baseline and the fallback.
2. Write ONE pure validator `(v: unknown) => v is Raw` for the whole bundle, as the contract (`openapi.yaml`) and `content/` spec require, run once per bundle: every row, every required key, its type and its contract bounds (finite numbers, minimums such as `>= 0` and `exclusiveMinimum: 0`, uuid ids, `maxLength`s), plus a generous upper bound for values the contract leaves open (check the shipped data's real ranges and leave headroom). Reject empty lists where an empty bundle would leave a screen useless. It must never throw (a throw counts as a rejection). Do not write a second, narrower validator for another reader: that lets two screens disagree about one stored copy.
3. Export the single decision: `export const chosenFoods = contentReader('foods', shippedImport, isFoods);`. It returns the stored copy chosen at app start only if the whole bundle validates, else the shipped import, and runs once until the next `loadContent`. Every reader of that bundle (catalog, About sources, and so on) derives from this one getter, so a stored copy is wholly used or wholly rejected. Derive values with `perLoad(() => chosenFoods().foods)`; `perLoad` computes at first call after each `loadContent` and is memoised.
4. If screens look rows up by name (past-day totals, core meal rules), the validator must also require every name in the shipped copy (additions and value edits allowed; removals and renames reject the copy). Foods does this.
5. Replace each use of the old constant with a call to the getter, inside the function or component (never at module level).
6. Tests (see `__tests__/content-readers-foods.test.ts`): shipped copy when nothing is stored; a valid newer copy is used only after `loadContent` (assert the same reference and a validator spy count, so the test fails without the memo); one rejection case per checked key and bound (negative, huge, zero, non-uuid, empty, 5000 characters); a validator that throws; every reader of the bundle agrees on accept and reject.

A bundle `name` is the file name without `.json` (it must exist in `bundled.json`). `loadContent` already drops copies whose `schema_version` this build does not support.

A bundle that another area still reads from the shipped import (raw-ingredients until recipes migrate) is read from the shipped import by every reader until all of them move together.
