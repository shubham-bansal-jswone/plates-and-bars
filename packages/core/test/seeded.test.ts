import { seededSession, type SeededSessionInput } from '../src/index';

const tags = {};
const base: SeededSessionInput = { base: 'pull-a', seeded: ['Row', 'Curl', 'Pulldown'], picks: ['Row', 'Pulldown', 'Face Pull'], date: '2026-05-13', where: 'gym', tags, lastSets: () => 4 };

describe('seededSession (#1020)', () => {
  it('keeps the base', () => {
    expect(seededSession(base).base).toBe('pull-a');
  });
  it('drops removed exercises and keeps pick order', () => {
    expect(seededSession(base).exercises.map((e) => e.name)).toEqual(['Row', 'Pulldown', 'Face Pull']);
  });
  it('a lighter check-in stores light mods and takes a set off the remaining exercises only', () => {
    const s = seededSession({ ...base, ciChoice: 'light' });
    expect(s.mods.light).toBe(true);
    expect(s.exercises.map((e) => e.sets)).toEqual([3, 3, 4]);
  });
  it('an added exercise gets plain defaults', () => {
    const s = seededSession({ ...base, ciChoice: 'light' });
    expect(s.exercises[2]).toEqual({ name: 'Face Pull', sets: 4, bridge: false });
    expect(seededSession({ ...base, ciChoice: 'light', lastSets: () => undefined }).exercises.map((e) => e.sets)).toEqual([2, 2, 3]);
    expect(seededSession({ ...base, ciChoice: 'light', lastSets: (n) => (n === 'Face Pull' ? undefined : 5) }).exercises.map((e) => e.sets)).toEqual([4, 4, 3]);
  });
  it('a deload applies to remaining exercises and the mods record it', () => {
    const s = seededSession({ ...base, deload: { from: '2026-05-10', until: '2026-05-16' } });
    expect(s.mods.deload).toBe(true);
    expect(s.exercises.map((e) => e.sets)).toEqual([3, 3, 4]);
  });
  it('re-entry applies and is stored', () => {
    const s = seededSession({ ...base, reentry: { from: '2026-05-10', until: '2026-05-16', pct: 0.3 } });
    expect(s.mods.reentry).toBe(0.3);
    expect(s.exercises.map((e) => e.sets)).toEqual([3, 3, 4]);
  });
  it('no adjustments leaves defaults and plain mods', () => {
    const s = seededSession(base);
    expect(s.mods).toEqual({ light: false, short: false, where: 'gym', deload: false, reentry: 0 });
    expect(s.exercises.map((e) => e.sets)).toEqual([4, 4, 4]);
  });
});
