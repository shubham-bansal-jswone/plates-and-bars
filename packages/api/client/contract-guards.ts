// Compile-time guards on the generated schema. `npm run typecheck` (part of `npm run check`)
// fails if a sync table is added to or removed from one of these without the others.
import type { components } from "./schema";

type Schemas = components["schemas"];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type SyncChangesCoversSyncTable = Assert<Equal<keyof Schemas["SyncChanges"], Schemas["SyncTable"]>>;
export type ExportTablesCoversSyncTable = Assert<Equal<keyof Schemas["ExportTables"], Schemas["SyncTable"]>>;

// Request bodies the app builds must be real object types: a schema the generator cannot express (such as an
// `anyOf` of bare `required` branches) comes out as `unknown`, which accepts anything (#953).
type IsUnknown<T> = unknown extends T ? true : false;
export type ImportRecipeRequestIsTyped = Assert<Equal<IsUnknown<Schemas["ImportRecipeRequest"]>, false>>;
export type ImportRecipeRequestRejectsUnknownKeys = Assert<Equal<"nonsense" extends keyof Schemas["ImportRecipeRequest"] ? true : false, false>>;
