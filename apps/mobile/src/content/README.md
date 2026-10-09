# Reading content bundles in screens

Server copies of the `content/*.json` bundles are fetched and stored by `refresh.ts`, chosen once at app start by `loadContent` (called from the database `onInit` in `app/_layout.tsx`) and applied on the NEXT launch. No hot-swap.

## Why readers are lazy

`SQLiteProvider` renders its children (the router and every screen) only after `onInit` has finished, so `loadContent` has always run before any screen code. What broke the first design was module-level constants such as `export const catalogFoods = foods.foods`, evaluated when the module is imported, which can be before the database init. So: never build anything from a content import at module level. Build it in a getter.

## The pattern (copy `src/food/catalog.ts`)

1. Keep the static JSON import. It is the synchronous baseline and the fallback.
2. Write a pure shape validator `(v: unknown) => v is Raw` that checks every key and type the reader uses (not more). It must never throw. Use `isObj`, `isStr`, `isNum`, `isNumOrNull`, `isStrOrNull`, `isArrOf` from `reader.ts`. Reject empty lists where an empty bundle would leave the screen useless.
3. Export a getter made with `contentReader(name, shippedImport, validator, read)`:

```ts
export const getFoodCatalog = contentReader('foods', foods as unknown as FoodsBundle, isFoods, (b) => b.foods);
```

   The getter uses the stored copy chosen at start only if the validator accepts it, otherwise the shipped import. It computes at first call and returns the same value until the next `loadContent`. Use `perLoad(() => ...)` for a value derived from several readers (see `getFoodSources`).
4. Replace each use of the old constant with a call to the getter, inside the function or component (never at module level). It is cheap after the first call.
5. Tests (see `__tests__/content-readers-foods.test.ts`): shipped copy with nothing stored; a valid newer stored copy is used only after `loadContent` (not when stored mid-session); an invalid-shape stored copy falls back to shipped; reader-specific bad shapes (null, empty, wrong types).

Bundle `name` is the file name without `.json` (it must exist in `bundled.json`). A reader that needs the stored copy's `schema_version` has nothing to do: `loadContent` already drops copies whose version this build does not support.
