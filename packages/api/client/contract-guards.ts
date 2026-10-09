// Compile-time guards on the generated schema. `npm run typecheck` (part of `npm run check`)
// fails if a sync table is added to or removed from one of these without the others.
import type { components } from "./schema";

type Schemas = components["schemas"];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type SyncChangesCoversSyncTable = Assert<Equal<keyof Schemas["SyncChanges"], Schemas["SyncTable"]>>;
export type ExportTablesCoversSyncTable = Assert<Equal<keyof Schemas["ExportTables"], Schemas["SyncTable"]>>;
