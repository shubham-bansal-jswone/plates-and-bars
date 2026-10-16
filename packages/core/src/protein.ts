/**
 * The protein "floor" the protein Why card quotes: the amount a meta-analysis finds muscle-building
 * benefits level off at, 1.6 g per kg of bodyweight a day.
 *
 * Ports the `Math.round(w*1.6)` step of the `protein` card body in
 * docs/prototype/plate-and-bar.html line 2792:
 * `At ${r1(w)} kg, 1.6 g/kg is about ${Math.round(w*1.6)} g.` The weight `w` there is
 * `latestWeight() || profile.weight`. The multiplication uses the raw `w`; `r1` only formats the
 * weight the sentence shows (callers show it with `round1`, as the prototype's `r1` does).
 */

/** Prototype `1.6` in the protein card: grams of protein per kg of bodyweight. */
export const PROTEIN_PER_KG = 1.6;

/**
 * `Math.round(kg * 1.6)`: the protein a bodyweight of `kg` needs for the meta-analysis floor.
 *
 * Mirrors prototype `KB.protein.b`'s `Math.round(w*1.6)` (docs/prototype/plate-and-bar.html line 2792).
 */
export function proteinFloor(kg: number): number {
  return Math.round(kg * PROTEIN_PER_KG);
}
