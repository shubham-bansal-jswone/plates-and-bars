import { MARKERS } from '@plate-and-bar/core';
import { labs, tipText } from '../src/labs/content';

describe('content/labs.json in the app', () => {
  it('has a tip for exactly the sides core says each of the 14 markers has one for', () => {
    expect(MARKERS).toHaveLength(14);
    for (const m of MARKERS) expect(Object.keys(labs.markers[m.key] ?? {}).sort()).toEqual([...m.tips].sort());
    expect(Object.keys(labs.markers)).toHaveLength(14);
  });

  it('picks the red notice, the marker tip or the generic notice by the code core returns', () => {
    expect(tipText('red', 'ldl')).toBe(labs.red_notice);
    expect(tipText('low', 'vitamin_d')).toBe(labs.markers.vitamin_d?.low);
    expect(tipText('high', 'tsh')).toBe(labs.markers.tsh?.high);
    expect(tipText('generic', 'ldl')).toBe(labs.generic_notice);
    expect(tipText('generic', null)).toBe(labs.generic_notice);
    expect(labs.red_notice).toMatch(/well outside the lab’s range/);
    expect(labs.red_notice).toMatch(/won’t give lifestyle tips/);
  });

  it('says it is not medical advice and points to a doctor, and the notices stay informational', () => {
    expect(labs.not_medical_advice).toMatch(/not medical advice/i);
    expect(labs.not_medical_advice).toMatch(/see a doctor/i);
    const all = JSON.stringify(labs);
    expect(all).not.toMatch(/\b(you have|diagnos(is|ed) of|take \d+ ?(mg|iu)|dose of)\b/i);
  });
});
