import { resolveName, replFromSwaps, isExcluded, type ExerciseCatalog, type ResolveState, type Where } from '../src/index';

type Item = { name: string; bridge?: boolean };

/**
 * Whether #143 can apply to `names`: some slot's swap or stored pick, with the session ignored, ends on
 * a name another slot holds (as it is, or after its own swap or pick), and that swap has no running
 * bridge (a bridged swap is kept, as the prototype does).
 */
export function clash143(names: readonly string[], where: Where, s: ResolveState, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>): boolean {
  const repl = replFromSwaps(s.swaps);
  const alone = names.map((n) => resolveName(n, where, s, catalog));
  return names.some((n, k) => {
    const a = alone[k];
    if (!a || a === n) return false;
    const rp = repl[n];
    if (rp && rp.bridgeUntil && rp.bridgeUntil >= s.date && a === rp.to && !isExcluded(n, s.exclusions, catalog.tags)) return false;
    return names.some((m, j) => m !== n && (alone[j] === a || m === a));
  });
}

/**
 * The port's resolved session matches the prototype's, except where #143 applies (`clash143`). Then the
 * port repeats no name, keeps the same bridges, and keeps at least as many slots (shown or `lost`).
 * Pass `want.lost` as null when the prototype's lost list is not known.
 */
export function expectProtoOr143(
  got: { items: Item[]; lost: string[] },
  want: { items: Item[]; lost: string[] | null },
  names: readonly string[],
  where: Where,
  s: ResolveState,
  catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>,
): boolean {
  const same = JSON.stringify(got.items) === JSON.stringify(want.items) && (want.lost === null || JSON.stringify(got.lost) === JSON.stringify(want.lost));
  if (same) return false;
  expect(clash143(names, where, s, catalog)).toBe(true);
  expect(new Set(got.items.map((x) => x.name)).size).toBe(got.items.length);
  const bridges = (xs: Item[]) => xs.filter((x) => x.bridge).map((x) => x.name);
  expect(bridges(got.items)).toEqual(bridges(want.items));
  expect(got.items.length + (want.lost === null ? 0 : got.lost.length)).toBeGreaterThanOrEqual(want.items.length + (want.lost?.length ?? 0));
  return true;
}
