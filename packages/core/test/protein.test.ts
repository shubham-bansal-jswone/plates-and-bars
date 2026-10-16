import { PROTEIN_PER_KG, proteinFloor, round1 } from '../src/index';
import { loadProtein } from './prototype-protein';

const proto = loadProtein();

/**
 * The weight and floor the prototype's protein card prints for a given latest weigh-in and profile
 * weight, or null when it prints no "At …" sentence (a falsy weight).
 */
function protoCard(latest: number | null | undefined, profileWeight?: number): { weight: number; protein: number } | null {
  proto.S.weights.entries = latest == null ? {} : { '2026-10-01': latest };
  proto.S.settings.profile = profileWeight === undefined ? {} : { weight: profileWeight };
  const m = proto.proteinBody().match(/At ([\d.]+) kg, 1\.6 g\/kg is about (\d+) g\./);
  return m ? { weight: Number(m[1]), protein: Number(m[2]) } : null;
}

describe('proteinFloor (prototype KB.protein.b, plate-and-bar.html line 2792)', () => {
  it('matches the prototype card: round1 for the label, proteinFloor for the grams', () => {
    for (const kg of [80, 81.6, 70, 62.5, 100.5, 55, 70.3125]) {
      const card = protoCard(kg, 60);
      expect(card).not.toBeNull();
      expect(card?.weight).toBe(round1(kg));
      expect(card?.protein).toBe(proteinFloor(kg));
    }
  });

  it.each([
    [80, 128], // 80 × 1.6
    [81.6, 131], // 130.56
    [70, 112],
    [62.5, 100],
    [100.5, 161], // 160.8
    [55, 88],
    [0, 0],
  ])('proteinFloor(%s) === %s', (kg, g) => {
    expect(proteinFloor(kg)).toBe(g);
  });

  it('multiplies the raw weight; r1 only formats the label', () => {
    // 70.3125 kg is not a saved weight (weigh-ins round to one decimal), but it pins the step order:
    // the prototype multiplies w, not r1(w), so the two round differently here.
    expect(round1(70.3125)).toBe(70.3);
    expect(Math.round(round1(70.3125) * 1.6)).toBe(112); // if the port rounded the weight first
    expect(proteinFloor(70.3125)).toBe(113); // prototype: Math.round(w * 1.6)
    expect(protoCard(70.3125)).toEqual({ weight: 70.3, protein: 113 });
  });

  it('is 0 at 0 kg, and the card prints no sentence for a falsy weight', () => {
    expect(proteinFloor(0)).toBe(0);
    expect(protoCard(0)).toBeNull();
    expect(protoCard(null, undefined)).toBeNull();
  });

  it('falls back to the profile weight when there is no weigh-in', () => {
    expect(protoCard(null, 80)).toEqual({ weight: round1(80), protein: proteinFloor(80) });
  });

  it('uses the meta-analysis 1.6 g/kg', () => {
    expect(PROTEIN_PER_KG).toBe(1.6);
  });
});
