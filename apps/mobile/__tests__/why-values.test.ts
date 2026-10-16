import { fibreTarget } from '@plate-and-bar/core';
import { profileWhyValues } from '../src/why/values';
import { renderBody, whyCard } from '../src/why/cards';
import { buildProfile, emptyDraft } from '../src/setup/logic';

const profile = (over: Record<string, unknown>) =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '170', weight: '80', activity: 'sitting', where: 'gym', days: 4, exp: 'new', minutes: 45, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'], ...over },
    new Date(2026, 8, 1),
  );

describe('profileWhyValues: split card', () => {
  it('fills days, split name, minutes and the new-lifter section', () => {
    const body = renderBody(whyCard('split')!.body, profileWhyValues(profile({})));
    expect(body).toMatch(/^You train 4 days a week, so your plan uses an upper\/lower split, which/);
    expect(body).toContain('about 45 minutes');
    expect(body).toContain('starting with 2 sets per exercise for your first 2 weeks');
  });
  it('falls back to "your time" and drops the new-lifter section', () => {
    const body = renderBody(whyCard('split')!.body, profileWhyValues({ ...profile({ exp: 'some' }), minutes: null }));
    expect(body).toContain('trimmed to fit your time,');
    expect(body).not.toContain('starting with 2 sets');
  });
});

describe('profileWhyValues: fibre target day', () => {
  const p = profile({});
  const flex = [{ id: 'a', date: '2026-10-08', kcal_delta: 800 }];
  it('follows that day\'s calorie target, flex included, as the Food tab does', () => {
    expect(fibreTarget(p.targets.kcal + 800)).not.toBe(fibreTarget(p.targets.kcal));
    expect(profileWhyValues(p, { date: '2026-10-08', flex }).fibre_g).toBe(fibreTarget(p.targets.kcal + 800));
  });
  it('ignores flex dated for another day, and uses the stored target without a day', () => {
    expect(profileWhyValues(p, { date: '2026-10-09', flex }).fibre_g).toBe(fibreTarget(p.targets.kcal));
    expect(profileWhyValues(p).fibre_g).toBe(fibreTarget(p.targets.kcal));
  });
});
