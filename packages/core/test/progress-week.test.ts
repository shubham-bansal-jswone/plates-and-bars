import { addDays, weekSummary, type ProgressDay } from '../src/index';
import { prototypeSource, sliceLine } from './helpers';
import { rng } from './prototype-plan';

const DATE = '2026-10-14';

interface ProtoWeek {
  stored: Record<string, { meals: { qty: number; kcal: number; p: number; c: number; f: number }[]; workout: { exercises: { sets: { done?: boolean }[] }[] } }>;
  render(date: string, kcal: number): Promise<string>;
}

/** The prototype's own "Seven days" code, cut out of `renderProgress()` and run on a fake `S` and `Store`. */
function loadWeek(): ProtoWeek {
  const src = prototypeSource();
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l.startsWith('async function renderProgress(){'));
  const first = lines.findIndex((l, i) => i > from && l.startsWith('  const keys = Array.from({length:7}'));
  const end = lines.findIndex((l, i) => i > first && l === '}');
  if (from < 0 || first < 0 || end < 0) throw new Error('prototype: renderProgress week block not found');
  const code = [
    "const S = { date:'', day:null, tab:'progress', settings:{ kcal:0 } };",
    'const stored = {}; const el = { innerHTML: "" }; const $ = q => (q === "#week" ? el : null);',
    "const Store = { get: k => Promise.resolve(stored[k.slice(4)] ? JSON.parse(JSON.stringify(stored[k.slice(4)])) : null) };",
    'const normDay = d => d || { meals: [], workout: { exercises: [] } };',
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const dayName = '),
    lines.slice(lines.findIndex((l) => l.startsWith('function totals(meals = S.day.meals){')), lines.findIndex((l, i) => i > 0 && l === '}' && lines[i - 2]?.startsWith('function totals(')) + 1).join('\n'),
    `async function week(){\n${lines.slice(first, end).join('\n')}\n}`,
    'return { stored, render: async (date, kcal) => { S.date = date; S.settings.kcal = kcal; S.day = normDay(stored[date]); el.innerHTML = ""; await week(); return el.innerHTML; } };',
  ].join('\n');
  return new Function(code)() as ProtoWeek;
}

const proto = loadWeek();
const names = (html: string) => [...html.matchAll(/<div class="lab"><b>([^<]*)<\/b>(trained)?/g)].map((m) => [m[1], !!m[2]] as const);

function setDays(days: readonly ProgressDay[]): void {
  for (const k of Object.keys(proto.stored)) delete proto.stored[k];
  for (const d of days) {
    // Deleted logs are not meals in the prototype (it removes them).
    proto.stored[d.date] = {
      meals: d.logs.filter((l) => l.deleted_at == null).map((l) => ({ qty: l.qty, kcal: l.kcal, p: l.protein_g, c: l.carbs_g, f: l.fat_g })),
      workout: { exercises: [{ sets: [{ done: d.trained }] }] },
    };
  }
}

describe('weekSummary', () => {
  it('golden numbers: one logged day over target, one under, one blank', () => {
    const days: ProgressDay[] = [
      { date: DATE, logs: [{ name: 'a', qty: 2, kcal: 1000, protein_g: 40.4, carbs_g: 0, fat_g: 0 }], trained: true },
      { date: addDays(DATE, -1), logs: [{ name: 'b', qty: 1, kcal: 1200.5, protein_g: 80, carbs_g: 0, fat_g: 0 }, { name: 'gone', qty: 1, kcal: 999, protein_g: 99, carbs_g: 0, fat_g: 0, deleted_at: '2026-10-14T00:00:00Z' }], trained: false },
    ];
    const w = weekSummary(days, DATE, 1900);
    expect(w.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, k) => addDays(DATE, k - 6)));
    const [today, yesterday, blank] = [w.days[6], w.days[5], w.days[0]];
    expect(today).toEqual({ date: DATE, logged: true, kcal: 2000, protein_g: 80.8, trained: true, fillPct: (2000 / 2470) * 100, targetPct: (1900 / 2470) * 100, over: true });
    expect(yesterday).toMatchObject({ logged: true, kcal: 1200.5, protein_g: 80, over: false });
    expect(blank).toMatchObject({ logged: false, kcal: 0, protein_g: 0, trained: false, fillPct: 0, over: false });
    expect(w.avgKcal).toBe(1600.25);
    expect(w.avgProtein_g).toBe(80.4);
    expect(w.sessions).toBe(1);
  });
  it('a week with nothing logged has no averages; the bar is capped at full', () => {
    expect(weekSummary([], DATE, 1900)).toMatchObject({ avgKcal: null, avgProtein_g: null, sessions: 0 });
    const huge = weekSummary([{ date: DATE, logs: [{ name: 'a', qty: 1, kcal: 9000, protein_g: 1, carbs_g: 0, fat_g: 0 }], trained: false }], DATE, 1900);
    expect(huge.days[6]?.fillPct).toBe(100);
  });
  it('a zero target does not divide by zero', () => {
    const w = weekSummary([{ date: DATE, logs: [{ name: 'a', qty: 1, kcal: 500, protein_g: 1, carbs_g: 0, fat_g: 0 }], trained: false }], DATE, 0);
    expect(w.days[6]).toMatchObject({ fillPct: 100, targetPct: 0, over: true });
  });
  it('a day exactly on target is not over, and a day with only deleted logs is blank', () => {
    const onTarget = weekSummary([{ date: DATE, logs: [{ name: 'a', qty: 1, kcal: 1900, protein_g: 1, carbs_g: 0, fat_g: 0 }], trained: false }], DATE, 1900);
    expect(onTarget.days[6]).toMatchObject({ logged: true, kcal: 1900, over: false });

    const gone = weekSummary([{ date: DATE, logs: [{ name: 'a', qty: 1, kcal: 500, protein_g: 10, carbs_g: 0, fat_g: 0, deleted_at: '2026-10-14T00:00:00Z' }], trained: false }], DATE, 1900);
    expect(gone.days[6]).toMatchObject({ logged: false, kcal: 0, protein_g: 0, over: false });
    // A day whose logs are all deleted counts as no logged day, so there is no average.
    expect(gone.avgKcal).toBeNull();
    expect(gone.avgProtein_g).toBeNull();
  });
  it('matches the prototype over 500 random weeks', async () => {
    const r = rng(489);
    let over = 0, blank = 0, sessions = 0;
    for (let i = 0; i < 500; i++) {
      const days: ProgressDay[] = [];
      for (let b = 0; b < 8; b++) {
        if (r() < 0.3) continue;
        days.push({
          date: addDays(DATE, -b),
          logs: Array.from({ length: Math.floor(r() * 5) }, (_, j) => ({ name: `f${j}`, qty: [0.5, 1, 1.5, 2][Math.floor(r() * 4)] as number, kcal: 50 + Math.floor(r() * 700) + (r() < 0.2 ? 0.5 : 0), protein_g: Math.round(r() * 400) / 10, carbs_g: 1, fat_g: 1 })),
          trained: r() < 0.4,
        });
      }
      const kcal = 1200 + Math.floor(r() * 1500);
      setDays(days);
      const html = await proto.render(DATE, kcal), w = weekSummary(days, DATE, kcal);
      expect(names(html)).toEqual(w.days.map((d) => [new Date(Number(d.date.slice(0, 4)), Number(d.date.slice(5, 7)) - 1, Number(d.date.slice(8))).toLocaleDateString('en-IN', { weekday: 'short' }), d.trained]));
      const rows = html.split('<div class="wk-r">').slice(1);
      rows.forEach((row, k) => {
        const d = w.days[k]!;
        const day = new Date(Number(d.date.slice(0, 4)), Number(d.date.slice(5, 7)) - 1, Number(d.date.slice(8))).toLocaleDateString('en-IN', { weekday: 'short' });
        // #503: names the day, mentions a session, and says "not logged" instead of announcing zeros.
        expect(row).toContain(`aria-label="${day}${d.trained ? ', trained' : ''}, ${d.logged ? `${Math.round(d.kcal).toLocaleString('en-IN')} kcal, ${Math.round(d.protein_g).toLocaleString('en-IN')} g protein` : 'not logged'}"`);
        expect(row).toContain(`style="width:${d.fillPct}%"`);
        expect(row).toContain(`style="left:${d.targetPct}%"`);
        expect(row.includes('class="fill over"')).toBe(d.over);
        expect(row.includes('not logged')).toBe(!d.logged);
        if (d.logged) expect(row).toContain(`<span>${Math.round(d.kcal).toLocaleString('en-IN')} kcal</span><span>${Math.round(d.protein_g).toLocaleString('en-IN')} g P</span>`);
        if (d.over) over++;
        if (!d.logged) blank++;
      });
      const f = (n: number): string => Math.round(n).toLocaleString('en-IN');
      expect(html).toContain(`<b>${w.avgKcal === null ? '–' : f(w.avgKcal)}</b>avg kcal`);
      expect(html).toContain(`<b>${w.avgProtein_g === null ? '–' : f(w.avgProtein_g) + ' g'}</b>avg protein`);
      expect(html).toContain(`<b>${w.sessions}</b>sessions`);
      sessions += w.sessions;
    }
    expect(over).toBeGreaterThan(50);
    expect(blank).toBeGreaterThan(50);
    expect(sessions).toBeGreaterThan(100);
  });
});
