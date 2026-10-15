import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { parse } from 'yaml';
import { DEFAULT_WATER_SIZES } from '../src/index';
import { prototypeSource, REPO_ROOT } from './helpers';

describe('DEFAULT_WATER_SIZES (#158)', () => {
  const src = prototypeSource();

  it('matches every `settings.water` fallback in the prototype', () => {
    const objects = [...src.matchAll(/\{ glass:(\d+), bottle:(\d+) \}/g)];
    // renderTargets' water card and the data-wt handler.
    expect(objects).toHaveLength(2);
    for (const m of objects) expect({ glass_ml: Number(m[1]), bottle_ml: Number(m[2]) }).toEqual(DEFAULT_WATER_SIZES);
    // The Settings screen's water size fields.
    const glass = [...src.matchAll(/\(S\.settings\.water \|\| \{\}\)\.glass \|\| (\d+)/g)].map((m) => Number(m[1]));
    const bottle = [...src.matchAll(/\(S\.settings\.water \|\| \{\}\)\.bottle \|\| (\d+)/g)].map((m) => Number(m[1]));
    expect(glass).toEqual([DEFAULT_WATER_SIZES.glass_ml]);
    expect(bottle).toEqual([DEFAULT_WATER_SIZES.bottle_ml]);
  });

  it('pins the values: a 250 ml glass and a 1000 ml bottle', () => {
    expect(DEFAULT_WATER_SIZES).toEqual({ glass_ml: 250, bottle_ml: 1000 });
  });

  it('is valid contract Settings.water_sizes', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addSchema(parse(readFileSync(resolve(REPO_ROOT, 'packages/api/openapi.yaml'), 'utf8')) as object, 'openapi.json');
    const validate = ajv.getSchema('openapi.json#/components/schemas/Settings/allOf/1/properties/water_sizes');
    if (!validate) throw new Error('Settings.water_sizes schema not found in openapi.yaml');
    expect(validate(DEFAULT_WATER_SIZES)).toBe(true);
    expect(validate({ glass_ml: 0, bottle_ml: 1000 })).toBe(false);
  });

  it('is frozen, so a caller cannot change the shared default', () => {
    expect(Object.isFrozen(DEFAULT_WATER_SIZES)).toBe(true);
  });
});
