import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import type { components } from '../../api/client/schema';
import {
  liftStatTombstone,
  liftStatToRecord,
  recordToLiftStat,
  updateLift,
  type LiftRecord,
  type LiftStatBody,
  type LiftStatTombstone,
  type SetEntry,
} from '../src/index';
import { REPO_ROOT } from './helpers';

// No golden fixture: the prototype kept lift records in localStorage and has no wire shape. The rules
// come from #135 and its review comments; outputs are validated against the contract's own schema.

type ContractLiftStat = components['schemas']['LiftStat'];
type Meta = Pick<ContractLiftStat, 'id' | 'version' | 'updated_at' | 'deleted_at'>;

// Compile-time: core's shapes and the generated contract types are assignable both ways.
const toContract = (b: LiftStatBody, m: Meta): ContractLiftStat => ({ ...m, ...b });
const fromContract = (s: ContractLiftStat): LiftStatBody => s;
const tombstoneToContract = (t: LiftStatTombstone, m: Omit<Meta, 'deleted_at'>): ContractLiftStat => ({ ...m, ...t });

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(parse(readFileSync(resolve(REPO_ROOT, 'packages/api/openapi.yaml'), 'utf8')) as object, 'openapi.json');
const validateLiftStat = ajv.getSchema('openapi.json#/components/schemas/LiftStat');
if (!validateLiftStat) throw new Error('LiftStat schema not found in openapi.yaml');

const META: Meta = { id: '0b8e8a8e-3c1f-5d6a-9b2e-4f1a2b3c4d5e', version: 0, updated_at: '2026-10-09T07:00:00Z', deleted_at: null };
const expectValid = (rec: unknown): void => {
  const ok = validateLiftStat(rec);
  expect(validateLiftStat.errors ?? []).toEqual([]);
  expect(ok).toBe(true);
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const set = (w: number, r: number, rate: SetEntry['rate'] = null): SetEntry => ({ w: String(w), r: String(r), done: true, rate });
/** Records as `updateLift` writes them over four sessions, the latest last. */
function sessions(): LiftRecord[] {
  const days: [string, SetEntry[], 'yes' | 'no' | null][] = [
    ['2026-09-01', [set(60, 8, 'right'), set(60, 7, 'hard')], 'yes'],
    ['2026-09-04', [set(62.5, 8), set(62.5, 8, 'easy')], null],
    ['2026-09-08', [set(65, 6, 'fail')], 'no'],
    ['2026-09-11', [set(65, 9, 'right'), set(65, 8, 'right'), set(65, 8, 'hard')], 'yes'],
  ];
  const out: LiftRecord[] = [];
  let L: LiftRecord | null = null;
  for (const [date, s, form] of days) {
    const u = updateLift(L, { sets: s, form }, date, 'barbell');
    L = u?.record ?? null;
    out.push(L as LiftRecord);
  }
  return out;
}

describe('recordToLiftStat', () => {
  it('renames to contract fields; every record updateLift writes validates and round-trips', () => {
    for (const rec of sessions()) {
      const stat = recordToLiftStat('Barbell Bench Press', rec);
      expectValid(toContract(stat, META));
      const back = liftStatToRecord(stat);
      expect(back).toEqual({ ...rec, pbToast: rec.pbToast ?? null });
      expect(recordToLiftStat('Barbell Bench Press', back)).toEqual(stat);
    }
  });

  it('maps a three-session record field by field, inner prev without a prev key', () => {
    const rec = sessions()[2] as LiftRecord;
    const stat = recordToLiftStat('Barbell Bench Press', rec);
    expect(stat).toEqual({
      exercise: 'Barbell Bench Press',
      date: '2026-09-08',
      sets: [{ weight_kg: 65, reps: 6, rate: 'fail' }],
      form: 'no',
      sessions: 3,
      first: '2026-09-01',
      prev: {
        date: '2026-09-04',
        sets: [{ weight_kg: 62.5, reps: 8, rate: null }, { weight_kg: 62.5, reps: 8, rate: 'easy' }],
        form: null,
        prev: { date: '2026-09-01', sets: [{ weight_kg: 60, reps: 8, rate: 'right' }, { weight_kg: 60, reps: 7, rate: 'hard' }], form: 'yes' },
      },
      history: rec.hist?.map((h) => ({ date: h.date, score: h.e })),
      pb_toast_date: rec.pbToast ?? null,
    });
    expect(Object.keys(stat.prev?.prev ?? {})).not.toContain('prev');
  });

  it('older records: sessions = n || (prev ? 2 : 1), first = first || prev.date || date, nulls for the rest', () => {
    const bare: LiftRecord = { date: '2026-09-10', sets: [{ w: 40, r: 10 }] };
    const lone = recordToLiftStat('Lat Pulldown', bare);
    expect(lone).toEqual({
      exercise: 'Lat Pulldown',
      date: '2026-09-10',
      sets: [{ weight_kg: 40, reps: 10, rate: null }],
      form: null,
      sessions: 1,
      first: '2026-09-10',
      prev: null,
      history: [],
      pb_toast_date: null,
    });
    expectValid(toContract(lone, META));

    const withPrev: LiftRecord = { ...bare, n: 0, prev: { date: '2026-09-06', sets: [{ w: 37.5, r: 10 }] } };
    const two = recordToLiftStat('Lat Pulldown', withPrev);
    expect(two.sessions).toBe(2);
    expect(two.first).toBe('2026-09-06');
    expect(two.prev).toEqual({ date: '2026-09-06', sets: [{ weight_kg: 37.5, reps: 10, rate: null }], form: null });
    expect(two.prev).not.toHaveProperty('prev');
    expectValid(toContract(two, META));

    expect(recordToLiftStat('Lat Pulldown', { ...withPrev, n: 7, first: '2026-01-02' })).toMatchObject({ sessions: 7, first: '2026-01-02' });
    expect(recordToLiftStat('Lat Pulldown', { ...bare, first: '' }).first).toBe('2026-09-10');
  });

  it('keeps nested prev one level deep: a deeper prev is dropped, a null prev.prev is kept as null', () => {
    const deep = {
      date: '2026-09-10',
      sets: [{ w: 50, r: 8 }],
      prev: { date: '2026-09-07', sets: [], prev: { date: '2026-09-03', sets: [], prev: { date: '2026-09-01', sets: [] } } },
    } as unknown as LiftRecord;
    const stat = recordToLiftStat('Row', deep);
    expect(stat.prev?.prev).toEqual({ date: '2026-09-03', sets: [], form: null });
    expectValid(toContract(stat, META));

    const nullInner: LiftRecord = { date: '2026-09-10', sets: [], prev: { date: '2026-09-07', sets: [], prev: null } };
    const s2 = recordToLiftStat('Row', nullInner);
    expect(s2.prev).toHaveProperty('prev', null);
    expectValid(toContract(s2, META));
    expect(liftStatToRecord(s2).prev).toHaveProperty('prev', null);
  });

  it('history keeps the last 8 entries (contract maxItems)', () => {
    const hist = Array.from({ length: 10 }, (_, i) => ({ date: `2026-08-${String(i + 10)}`, e: i * 1.5 }));
    const stat = recordToLiftStat('Squat', { date: '2026-08-19', sets: [], hist });
    expect(stat.history).toEqual(hist.slice(2).map((h) => ({ date: h.date, score: h.e })));
    expectValid(toContract(stat, META));
  });
});

describe('liftStatToRecord', () => {
  const stat: ContractLiftStat = {
    ...META,
    version: 4,
    exercise: 'Barbell Back Squat',
    date: '2026-09-12',
    sets: [{ weight_kg: 100, reps: 5, rate: 'hard' }, { weight_kg: 100, reps: 5, rate: null }],
    form: 'yes',
    sessions: 9,
    first: '2026-06-01',
    prev: { date: '2026-09-09', sets: [{ weight_kg: 97.5, reps: 6, rate: 'right' }], form: null },
    history: [{ date: '2026-09-09', score: 113.4 }, { date: '2026-09-12', score: 116.7 }],
    pb_toast_date: '2026-09-12',
  };

  it('maps contract fields back and ignores the sync metadata', () => {
    expectValid(stat);
    expect(liftStatToRecord(stat)).toEqual({
      date: '2026-09-12',
      sets: [{ w: 100, r: 5, rate: 'hard' }, { w: 100, r: 5, rate: null }],
      form: 'yes',
      n: 9,
      first: '2026-06-01',
      prev: { date: '2026-09-09', sets: [{ w: 97.5, r: 6, rate: 'right' }], form: null },
      hist: [{ date: '2026-09-09', e: 113.4 }, { date: '2026-09-12', e: 116.7 }],
      pbToast: '2026-09-12',
    });
  });

  it('round-trips contract stats exactly (prev absent, prev.prev absent, null or a session)', () => {
    const inner = { date: '2026-09-05', sets: [{ weight_kg: 95, reps: 6, rate: 'easy' as const }], form: 'no' as const };
    const variants: ContractLiftStat[] = [
      stat,
      { ...stat, prev: null, pb_toast_date: null, form: null },
      { ...stat, prev: { ...(stat.prev as NonNullable<ContractLiftStat['prev']>), prev: null } },
      { ...stat, prev: { ...(stat.prev as NonNullable<ContractLiftStat['prev']>), prev: inner } },
    ];
    for (const v of variants) {
      expectValid(v);
      const { id, version, updated_at, deleted_at, ...body } = v;
      const back = recordToLiftStat(v.exercise, liftStatToRecord(clone(v)));
      expect(back).toEqual(body);
      // with the original sync metadata put back, the mapped body rebuilds the stat it came from
      expect(toContract(back, { id, version, updated_at, deleted_at })).toEqual(v);
      expectValid(toContract(back, META));
    }
  });

  it('drops a prev nested deeper than the contract allows', () => {
    const deep = clone(stat) as unknown as { prev: { prev: unknown } };
    deep.prev.prev = { date: '2026-09-05', sets: [], form: null, prev: { date: '2026-09-01', sets: [], form: null } };
    expect(validateLiftStat(deep)).toBe(false); // the schema rejects it ...
    const rec = liftStatToRecord(fromContract(deep as unknown as ContractLiftStat));
    expect(rec.prev?.prev).toEqual({ date: '2026-09-05', sets: [], form: null }); // ... the mapper trims it
    expect(rec.prev?.prev).not.toHaveProperty('prev');
  });
});

describe('contract schema checks the mapper relies on', () => {
  it('rejects an inner prev with a prev key, even null', () => {
    const body = recordToLiftStat('Row', { date: '2026-09-10', sets: [], prev: { date: '2026-09-07', sets: [], prev: { date: '2026-09-03', sets: [] } } });
    const bad = clone(toContract(body, META)) as unknown as { prev: { prev: Record<string, unknown> } };
    bad.prev.prev.prev = null;
    expect(validateLiftStat(bad)).toBe(false);
  });
});

describe('liftStatTombstone', () => {
  it('fills every required field and validates with the sync metadata', () => {
    const t = liftStatTombstone('Barbell Bench Press', '2026-10-09T06:30:00Z');
    expect(t).toEqual({
      exercise: 'Barbell Bench Press',
      date: '2026-10-09',
      sets: [],
      form: null,
      sessions: 1,
      first: '2026-10-09',
      prev: null,
      history: [],
      pb_toast_date: null,
      deleted_at: '2026-10-09T06:30:00Z',
    });
    expectValid(tombstoneToContract(t, { id: META.id, version: 3, updated_at: '2026-10-09T06:30:00Z' }));
  });
});
