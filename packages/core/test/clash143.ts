import { resolveName, replFromSwaps, isExcluded, type ExerciseCatalog, type ResolveState, type Where } from '../src/index';

/**
 * Whether #143 can apply to `names`: some slot's swap or stored pick, with the session ignored, ends on
 * a name another slot holds (as it is, or after its own swap or pick), and that swap has no running
 * bridge (a bridged swap is kept). The differential tests count these states, so the random grids are
 * known to reach the pass-over.
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
