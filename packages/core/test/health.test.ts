import { needsClearance, screenFlag, type HealthProfile } from '../src/index';
import { prototypeSource, sliceLine } from './helpers';

const allNo = { 0: 'no', 1: 'no', 2: 'no', 3: 'no', 4: 'no', 5: 'no' } as const;

describe('screenFlag', () => {
  it('is false without a profile or answers', () => {
    expect(screenFlag(null)).toBe(false);
    expect(screenFlag(undefined)).toBe(false);
    expect(screenFlag({})).toBe(false);
    expect(screenFlag({ screen: {} })).toBe(false);
    expect(screenFlag({ screen: allNo })).toBe(false);
  });

  it('is true when any answer is yes (prototype object shape)', () => {
    expect(screenFlag({ screen: { ...allNo, 3: 'yes' } })).toBe(true);
  });

  it('accepts the contract array shape', () => {
    expect(screenFlag({ screen: ['no', 'no', 'no', 'no', 'no', 'no'] })).toBe(false);
    expect(screenFlag({ screen: ['no', 'no', 'no', 'no', 'no', 'yes'] })).toBe(true);
    expect(screenFlag({ screen: [] })).toBe(false);
  });
});

describe('needsClearance', () => {
  it('is false with no profile', () => {
    expect(needsClearance(null)).toBe(false);
    expect(needsClearance(undefined)).toBe(false);
  });

  it('is false when every answer is no and not pregnant', () => {
    expect(needsClearance({ special: 'none', screen: allNo })).toBe(false);
  });

  it('is true for any yes until cleared', () => {
    const p: HealthProfile = { special: 'none', screen: { ...allNo, 0: 'yes' } };
    expect(needsClearance(p)).toBe(true);
    expect(needsClearance({ ...p, cleared: '2026-10-08' })).toBe(false);
  });

  it('is true for pregnancy until cleared, even with all answers no', () => {
    const p: HealthProfile = { special: 'pregnant', screen: allNo };
    expect(needsClearance(p)).toBe(true);
    expect(needsClearance({ ...p, cleared: '2026-10-08' })).toBe(false);
  });

  it('works with the contract array shape and a null cleared', () => {
    const p: HealthProfile = { special: 'none', screen: ['no', 'yes', 'no', 'no', 'no', 'no'], cleared: null };
    expect(needsClearance(p)).toBe(true);
    expect(needsClearance({ ...p, cleared: '2026-10-08' })).toBe(false);
    expect(needsClearance({ ...p, screen: ['no', 'no', 'no', 'no', 'no', 'no'] })).toBe(false);
  });

  it('is false for breastfeeding alone', () => {
    expect(needsClearance({ special: 'breastfeeding', screen: allNo })).toBe(false);
  });

  it('treats an empty or null cleared value as not cleared', () => {
    expect(needsClearance({ special: 'pregnant', cleared: '' })).toBe(true);
    expect(needsClearance({ special: 'pregnant', cleared: null })).toBe(true);
  });

  it('matches the prototype on every combination', () => {
    const src = prototypeSource();
    const code = `const S = { settings: { profile: null } };
${sliceLine(src, 'const screenFlag = ')}
${sliceLine(src, 'const needsClearance = ')}
return (p) => { S.settings.profile = p; return needsClearance(); };`;
    const proto = new Function(code)() as (p: unknown) => boolean;
    const profiles: (HealthProfile | null)[] = [null];
    const arrNo = ['no', 'no', 'no', 'no', 'no', 'no'] as const;
    const arrYes = ['yes', 'no', 'no', 'no', 'no', 'no'] as const;
    for (const special of [undefined, null, '', 'none', 'pregnant', 'breastfeeding'] as const)
      for (const screen of [undefined, {}, allNo, { ...allNo, 5: 'yes' as const }, [], arrNo, arrYes])
        for (const cleared of [undefined, null, '', '2026-10-08']) {
          const p: HealthProfile = {};
          if (special !== undefined) p.special = special;
          if (screen !== undefined) p.screen = screen;
          if (cleared !== undefined) p.cleared = cleared;
          profiles.push(p);
        }
    for (const p of profiles) expect(needsClearance(p)).toBe(proto(p));
  });
});
