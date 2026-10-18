import { DEFAULT_PREFS, buildSlots, clock, inQuiet, minutesOf, movedByQuiet, parsePrefs, type ReminderPrefs } from '../src/reminders/schedule';
import { nativeRules } from '../src/reminders/sync';

const on = (p: Partial<ReminderPrefs>): ReminderPrefs => ({ ...DEFAULT_PREFS, ...p });
const hm = (t: string) => minutesOf(t)!;

describe('reminder times', () => {
  it('reads 24 h times only', () => {
    expect(minutesOf('07:30')).toBe(450);
    expect(minutesOf('23:59')).toBe(1439);
    for (const bad of ['7:30', '24:00', '12:60', '', 'ab:cd', null, 730]) expect(minutesOf(bad)).toBeNull();
  });
  it('writes them back with two digits', () => {
    expect(clock(450)).toBe('07:30');
    expect(clock(24 * 60)).toBe('00:00');
    expect(clock(-30)).toBe('23:30');
  });
});

describe('quiet hours', () => {
  const night = { from: '22:00', to: '07:00' };
  it('cross midnight: the start is in, the end is out', () => {
    expect(inQuiet(hm('22:00'), night)).toBe(true);
    expect(inQuiet(hm('23:59'), night)).toBe(true);
    expect(inQuiet(hm('00:00'), night)).toBe(true);
    expect(inQuiet(hm('06:59'), night)).toBe(true);
    expect(inQuiet(hm('07:00'), night)).toBe(false);
    expect(inQuiet(hm('21:59'), night)).toBe(false);
  });
  it('within one day', () => {
    const nap = { from: '13:00', to: '15:00' };
    expect(inQuiet(hm('13:00'), nap)).toBe(true);
    expect(inQuiet(hm('14:59'), nap)).toBe(true);
    expect(inQuiet(hm('15:00'), nap)).toBe(false);
  });
  it('the same start and end means no quiet hours', () => {
    expect(inQuiet(hm('03:00'), { from: '22:00', to: '22:00' })).toBe(false);
  });
});

describe('parsePrefs', () => {
  it('has every reminder off by default', () => {
    for (const raw of [null, '', '{}', 'not json', '[]', 'null', '7']) {
      const p = parsePrefs(raw);
      expect(p).toEqual(DEFAULT_PREFS);
      expect([p.weigh_in.on, p.workout.on, p.lunch.on, p.dinner.on, p.water.on]).toEqual([false, false, false, false, false]);
    }
  });
  it('keeps valid values and drops invalid ones field by field', () => {
    const p = parsePrefs(JSON.stringify({ weigh_in: { on: true, time: '06:15' }, lunch: { on: 'yes', time: '25:00' }, water: { on: true, every_h: 5 }, quiet: { from: '23:00', to: 'x' } }));
    expect(p.weigh_in).toEqual({ on: true, time: '06:15' });
    expect(p.lunch).toEqual({ on: false, time: '13:30' }); // only `true` turns a reminder on
    expect(p.water).toEqual({ on: true, every_h: 3 });
    expect(p.quiet).toEqual({ from: '23:00', to: '07:00' });
  });
});

describe('buildSlots', () => {
  it('schedules nothing while everything is off', () => {
    expect(buildSlots(DEFAULT_PREFS, { days: 4 })).toEqual([]);
  });
  it('weigh-in and meals fall every day at their time', () => {
    const s = buildSlots(on({ weigh_in: { on: true, time: '07:30' }, dinner: { on: true, time: '20:30' } }), { days: 4 });
    expect(s.map((x) => [x.id, clock(x.minute), x.days.length])).toEqual([['weigh_in', '07:30', 7], ['dinner', '20:30', 7]]);
  });
  it('workout reminders follow the plan days from core (Sunday = 0)', () => {
    const p = on({ workout: { on: true, time: '17:30' } });
    expect(buildSlots(p, { days: 3 })[0]!.days).toEqual([1, 3, 5]);
    expect(buildSlots(p, { days: 4 })[0]!.days).toEqual([1, 2, 4, 5]);
    expect(buildSlots(p, { days: 6 })[0]!.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(buildSlots(p, null)[0]!.days).toEqual([1, 2, 3, 4, 5, 6]); // no profile: core's 6-day plan
    expect(buildSlots(p, { days: 0 })).toEqual([]); // no training days, nothing to remind about
  });
  it('a reminder inside quiet hours moves to where they end', () => {
    const p = on({ weigh_in: { on: true, time: '06:00' }, dinner: { on: true, time: '22:30' }, lunch: { on: true, time: '13:30' } });
    expect(buildSlots(p, null).map((x) => clock(x.minute))).toEqual(['07:00', '13:30', '07:00']);
    expect(movedByQuiet(p, 'weigh_in')).toBe(true);
    expect(movedByQuiet(p, 'lunch')).toBe(false);
  });
  it('water: every 3 h from 09:00 while awake', () => {
    const s = buildSlots(on({ water: { on: true, every_h: 3 } }), null);
    expect(s.map((x) => clock(x.minute))).toEqual(['09:00', '12:00', '15:00', '18:00', '21:00']);
    expect(s.every((x) => x.kind === 'water' && x.days.length === 7)).toBe(true);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
  });
  it('water: every 2 h reaches 21:00; every 4 h stops before it', () => {
    expect(buildSlots(on({ water: { on: true, every_h: 2 } }), null).map((x) => clock(x.minute))).toEqual(['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00']);
    expect(buildSlots(on({ water: { on: true, every_h: 4 } }), null).map((x) => clock(x.minute))).toEqual(['09:00', '13:00', '17:00', '21:00']);
  });
  it('water inside quiet hours is dropped, not moved', () => {
    const s = buildSlots(on({ water: { on: true, every_h: 3 }, quiet: { from: '17:00', to: '10:00' } }), null);
    expect(s.map((x) => clock(x.minute))).toEqual(['12:00', '15:00']);
  });
});

describe('nativeRules', () => {
  it('gives the module hour, minute, weekdays, copy and a plateandbar:// route', () => {
    const r = nativeRules(on({ weigh_in: { on: true, time: '07:30' }, workout: { on: true, time: '17:05' }, lunch: { on: true, time: '13:30' } }), { days: 3 });
    expect(r[0]).toEqual({ id: 'weigh_in', hour: 7, minute: 30, days: [0, 1, 2, 3, 4, 5, 6], title: 'Weigh-in', body: 'A quick weigh-in keeps your trend honest.', route: 'plateandbar://progress' });
    expect(r[1]).toMatchObject({ id: 'workout', hour: 17, minute: 5, days: [1, 3, 5], route: 'plateandbar://workout' });
    expect(r[2]).toMatchObject({ id: 'lunch', route: 'plateandbar://' });
    for (const x of r) expect(x.route.startsWith('plateandbar://')).toBe(true);
  });
  it('no notification text carries health data', () => {
    const all = nativeRules(on({ weigh_in: { on: true, time: '07:30' }, workout: { on: true, time: '17:30' }, lunch: { on: true, time: '13:30' }, dinner: { on: true, time: '20:30' }, water: { on: true, every_h: 3 } }), null);
    for (const x of all) expect(`${x.title} ${x.body}`).not.toMatch(/\d|kg|kcal|!/);
  });
});
