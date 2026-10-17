import { addPrep, isPrepEntry, logPrep, prepFor, PREP_DAYS, PREP_MAX, type Meal, type PrepEntry } from '../src/index';
import { loadPrep, type ProtoPrep } from './prototype-prep';
import { rng } from './prototype-plan';

const proto = loadPrep();
const MEALS: readonly Meal[] = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];
const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const DAYS = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];

const toProto = (p: PrepEntry): ProtoPrep => ({ id: p.id, name: p.name, meal: p.meal, left: p.left, until: p.until, food: { kcal: p.food.kcal, p: p.food.protein_g, c: p.food.carbs_g, f: p.food.fat_g } });
const fromProto = (p: ProtoPrep): PrepEntry => ({ id: p.id, name: p.name, meal: p.meal as Meal, left: p.left, until: p.until, food: { kcal: p.food.kcal, protein_g: p.food.p, carbs_g: p.food.c, fat_g: p.food.f } });
const entry = (over: Partial<PrepEntry> = {}): PrepEntry => ({ id: 'a', name: 'Dal', meal: 'Lunch', left: 3, until: '2026-10-14', food: { kcal: 161, protein_g: 7.8, carbs_g: 23.3, fat_g: 4.6 }, ...over });
const randomList = (rand: () => number): PrepEntry[] =>
  Array.from({ length: Math.floor(rand() * 5) }, (_, i) => entry({ id: `p${i}`, name: `Dish ${i}`, meal: pick(rand, MEALS), left: Math.floor(rand() * 5), until: pick(rand, DAYS) }));

describe('meal prep (prototype rb-prep, prepLineHtml, prep-log)', () => {
  it('addPrep matches case rb-prep: pruning, portions, expiry and rounding', () => {
    const rand = rng(690);
    for (let i = 0; i < 2000; i++) {
      const list = randomList(rand);
      const today = pick(rand, DAYS);
      const kat = pick(rand, [0.2, 0.5, 1, 1.4, 1.5, 2.5, 3.49, 4, 6.5, 12]);
      const per = { kcal: rand() * 400, p: rand() * 30, c: rand() * 60, f: rand() * 20 };
      const meal = pick(rand, MEALS);
      const want = proto.add(list.map(toProto), 'Rajma', meal, kat, per, today, 'new');
      const got = addPrep(list, { id: 'new', name: 'Rajma', meal, katoris: kat, perKatori: { kcal: per.kcal, protein_g: per.p, carbs_g: per.c, fat_g: per.f }, today });
      expect(got).toEqual(want.prep.map(fromProto));
      expect(want.toast).toBe(`Meal prep set: ${Math.round(kat)} portions for ${meal.toLowerCase()} this week`);
    }
  });

  it('prepFor matches prepLineHtml: meal, portions left and the last day (inclusive)', () => {
    const rand = rng(6901);
    let shown = 0;
    for (let i = 0; i < 2000; i++) {
      const list = randomList(rand);
      const meal = pick(rand, MEALS);
      const date = pick(rand, DAYS);
      const want = proto.line(list.map(toProto), meal, date);
      const got = prepFor(list, meal, date);
      expect(got.map((p) => p.id)).toEqual(want.ids);
      shown += got.length;
    }
    expect(shown).toBeGreaterThan(300);
  });

  it('logPrep matches case prep-log: one katori of the batch, one portion fewer', () => {
    const rand = rng(6902);
    for (let i = 0; i < 1000; i++) {
      const list = randomList(rand).filter((p) => p.left > 0);
      if (!list.length) continue;
      const target = pick(rand, list);
      const want = proto.log(list.map(toProto), target.id);
      const got = logPrep(list, target.id)!;
      expect(got.prep).toEqual(want.prep.map(fromProto));
      expect(want.meal).toMatchObject({ meal: target.meal, name: target.name, qty: 1, kcal: target.food.kcal, p: target.food.protein_g });
      expect(got.entry).toEqual(target);
    }
  });

  it('the prototype keeps a batch 6 days and the port says so', () => {
    expect(PREP_DAYS).toBe(6);
    expect(addPrep([], { id: 'x', name: 'Dal', meal: 'Lunch', katoris: 4, perKatori: { kcal: 160.4, protein_g: 7.84, carbs_g: 23.3, fat_g: 4.6 }, today: '2026-10-17' })).toEqual([
      { id: 'x', name: 'Dal', meal: 'Lunch', left: 4, until: '2026-10-23', food: { kcal: 160, protein_g: 7.8, carbs_g: 23.3, fat_g: 4.6 } },
    ]);
  });

  it('a batch of under half a katori still has one portion', () => {
    expect(addPrep([], { id: 'x', name: 'Dal', meal: 'Lunch', katoris: 0.2, perKatori: { kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }, today: '2026-10-17' })[0]?.left).toBe(1);
  });

  it('the last day still counts, the next does not', () => {
    const p = entry({ until: '2026-10-14' });
    expect(prepFor([p], 'Lunch', '2026-10-14')).toHaveLength(1);
    expect(prepFor([p], 'Lunch', '2026-10-15')).toHaveLength(0);
    expect(prepFor([entry({ left: 0 })], 'Lunch', '2026-10-10')).toHaveLength(0);
  });

  it('logPrep refuses a finished or unknown batch, so a second tap cannot go below 0', () => {
    expect(logPrep([entry({ left: 0 })], 'a')).toBeNull();
    expect(logPrep([entry()], 'zzz')).toBeNull();
    const once = logPrep([entry({ left: 1 })], 'a')!;
    expect(once.prep[0]?.left).toBe(0);
    expect(logPrep(once.prep, 'a')).toBeNull();
  });

  it('keeps at most the contract’s 100 entries, newest last, and leaves out items it did not write', () => {
    const many = Array.from({ length: 100 }, (_, i) => entry({ id: `p${i}`, until: '2026-12-31' }));
    const out = addPrep([...many, { junk: true }, null, 5], { id: 'new', name: 'Dal', meal: 'Lunch', katoris: 2, perKatori: { kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }, today: '2026-10-17' });
    expect(out).toHaveLength(PREP_MAX);
    expect(out[PREP_MAX - 1]?.id).toBe('new');
    expect(out[0]?.id).toBe('p1');
    expect(isPrepEntry({ id: 'a', name: 'x', meal: 'Brunch', left: 1, until: '2026-10-10', food: { kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 } })).toBe(false);
  });
});
