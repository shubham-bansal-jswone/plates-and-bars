import { DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET, DEFAULT_KCAL_TARGET, DEFAULT_PROTEIN_TARGET } from '../src/index';
import { prototypeSource, sliceLine } from './helpers';

interface ProtoDefaults {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Runs the prototype's own `DEFAULT_SETTINGS` line. */
function protoDefaults(): ProtoDefaults {
  const line = sliceLine(prototypeSource(), 'const DEFAULT_SETTINGS = ');
  return new Function(`${line}\nreturn DEFAULT_SETTINGS;`)() as ProtoDefaults;
}

describe('default macro targets (no profile)', () => {
  it('match prototype DEFAULT_SETTINGS', () => {
    const d = protoDefaults();
    expect(DEFAULT_KCAL_TARGET).toBe(d.kcal);
    expect(DEFAULT_PROTEIN_TARGET).toBe(d.protein);
    expect(DEFAULT_CARBS_TARGET).toBe(d.carbs);
    expect(DEFAULT_FAT_TARGET).toBe(d.fat);
  });

  it('pins the values: 150 g protein, 190 g carbs, 60 g fat', () => {
    expect([DEFAULT_PROTEIN_TARGET, DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET]).toEqual([150, 190, 60]);
  });

  it('add up to the default calorie target (4, 4 and 9 kcal per gram)', () => {
    expect(DEFAULT_PROTEIN_TARGET * 4 + DEFAULT_CARBS_TARGET * 4 + DEFAULT_FAT_TARGET * 9).toBe(DEFAULT_KCAL_TARGET);
  });
});
