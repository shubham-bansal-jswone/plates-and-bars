import { IMPORT_MAX_CHARS, IMPORT_MAX_ROWS, importDate, matchAll, matchExercise, parseCsv, parseWorkoutCsv, planImport, KG_PER_LB } from '../src';
import type { ImportParsed } from '../src';

const STRONG_HEAD = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';
const strong = (...rows: string[]) => [STRONG_HEAD, ...rows].join('\n');
const HEVY_HEAD = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
const hevy = (...rows: string[]) => [HEVY_HEAD, ...rows].join('\n');
const ok = (r: ReturnType<typeof parseWorkoutCsv>): ImportParsed => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.parsed;
};

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, newlines in a cell, CRLF, CR and a BOM', () => {
    const rows = parseCsv('﻿a,"b,1","say ""hi"""\r\n"x\ny",2,3\r4,5,6', ',');
    expect(rows).toEqual([['a', 'b,1', 'say "hi"'], ['x\ny', '2', '3'], ['4', '5', '6']]);
  });
  it('drops blank lines and tolerates an unclosed quote', () => {
    expect(parseCsv('a,b\n\n\nc,"d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('importDate', () => {
  it('reads Strong and Hevy dates as written, and refuses impossible ones', () => {
    expect(importDate('2024-03-27 18:30:00')).toBe('2024-03-27');
    expect(importDate('2024-03-27T18:30')).toBe('2024-03-27');
    expect(importDate('27 Mar 2024, 18:30')).toBe('2024-03-27');
    expect(importDate('5 January 2024')).toBe('2024-01-05');
    expect(importDate('2024-02-30 10:00:00')).toBeNull();
    expect(importDate('31 Foo 2024')).toBeNull();
    expect(importDate('yesterday')).toBeNull();
  });
});

describe('Strong files', () => {
  const csv = strong(
    '2024-03-27 18:30:00,Push Day,Bench Press (Barbell),1,60,8,0,0,,,',
    '2024-03-27 18:30:00,Push Day,Bench Press (Barbell),2,62.5,6,0,0,,,8',
    '2024-03-27 18:30:00,Push Day,"Fly, Cable",W,10,12,0,0,,,',
    '2024-03-27 18:30:00,Push Day,Running,1,0,0,5,1500,,,',
  );

  it('groups sets by day, skips warm-ups and cardio, and counts them', () => {
    const p = ok(parseWorkoutCsv(csv, 'strong', 'kg'));
    expect(p.days).toEqual([{ date: '2024-03-27', title: 'Push Day', sets: [{ exercise: 'Bench Press (Barbell)', weightKg: 60, reps: 8 }, { exercise: 'Bench Press (Barbell)', weightKg: 62.5, reps: 6 }] }]);
    expect(p.skipped).toEqual({ warmup: 1, cardio: 1, invalid: 0, duplicate: 0 });
    expect([p.sets, p.firstDate, p.lastDate, p.unit]).toEqual([2, '2024-03-27', '2024-03-27', 'kg']);
  });

  it('converts pounds to kg with the core factor', () => {
    const p = ok(parseWorkoutCsv(strong('2024-03-27 18:30:00,A,Squat,1,225,5,0,0,,,'), 'strong', 'lb'));
    expect(p.days[0]!.sets[0]!.weightKg).toBeCloseTo(225 * KG_PER_LB, 8);
    expect(p.unit).toBe('lb');
  });

  it('reads a semicolon file with decimal commas, a BOM and CRLF', () => {
    const text = `﻿${STRONG_HEAD.replace(/,/g, ';')}\r\n2024-03-27 18:30:00;"Pull; Day";Row;1;42,5;10;0;0;;;\r\n`;
    const p = ok(parseWorkoutCsv(text, 'strong', 'kg'));
    expect(p.days[0]!.title).toBe('Pull; Day');
    expect(p.days[0]!.sets[0]).toEqual({ exercise: 'Row', weightKg: 42.5, reps: 10 });
  });

  it('keeps a blank weight as null (bodyweight) and joins two workouts of one day', () => {
    const p = ok(parseWorkoutCsv(strong('2024-03-27 07:00:00,AM,Push-up,1,,15,0,0,,,', '2024-03-27 19:00:00,PM,Row,1,40,10,0,0,,,'), 'strong'));
    expect(p.days).toHaveLength(1);
    expect(p.days[0]!.title).toBe('AM + PM');
    expect(p.days[0]!.sets[0]!.weightKg).toBeNull();
  });

  it('counts unreadable rows and drops repeated rows of one workout', () => {
    const row = '2024-03-27 18:30:00,A,Row,1,40,10,0,0,,,';
    const p = ok(parseWorkoutCsv(strong(row, row, '2024-13-01 18:30:00,A,Row,1,40,10,0,0,,,', '2024-03-27 18:30:00,A,Row,2,-5,10,0,0,,,', '2024-03-27 18:30:00,A,Row,3,40,1e3,0,0,,,', '2024-03-27 18:30:00,A,Row,4,40,2.5,0,0,,,', '2024-03-27 18:30:00,A,,5,40,5,0,0,,,', '2024-03-27 18:30:00,A,Row,6,5000,5,0,0,,,', '2024-03-27 18:30:00,A,Row,Rest Timer,,,0,90,,,'), 'strong'));
    expect(p.sets).toBe(1);
    expect(p.skipped).toMatchObject({ duplicate: 1, invalid: 7, warmup: 0, cardio: 0 });
  });

  it('does not read a Hevy file as Strong', () => {
    expect(parseWorkoutCsv(hevy('A,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Row,,,0,normal,40,10,,,'), 'strong')).toEqual({ ok: false, error: 'not_recognised' });
  });
});

describe('Hevy files', () => {
  it('reads kg, groups by day, skips warm-up sets and distance rows', () => {
    const p = ok(
      parseWorkoutCsv(
        hevy(
          'Upper,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Bench Press (Barbell),,,0,warmup,20,10,,,',
          'Upper,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Bench Press (Barbell),,,1,normal,60,8,,,',
          'Upper,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Bench Press (Barbell),,,2,failure,60,6,,,',
          'Upper,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Run,,,0,normal,,,5,1500,',
          'Legs,"29 Mar 2024, 10:00","29 Mar 2024, 11:00",,Squat (Barbell),,,0,normal,100,5,,,',
        ),
        'hevy',
      ),
    );
    expect(p.unit).toBe('kg');
    expect(p.days.map((d) => [d.date, d.title, d.sets.length])).toEqual([['2024-03-27', 'Upper', 2], ['2024-03-29', 'Legs', 1]]);
    expect(p.skipped).toMatchObject({ warmup: 1, cardio: 1 });
  });

  it('takes the unit from the header: weight_lbs is pounds whatever the caller passed', () => {
    const text = hevy('A,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Row,,,0,normal,100,5,,,').replace('weight_kg', 'weight_lbs');
    const p = ok(parseWorkoutCsv(text, 'hevy', 'kg'));
    expect(p.unit).toBe('lb');
    expect(p.days[0]!.sets[0]!.weightKg).toBeCloseTo(100 * KG_PER_LB, 8);
  });

  it('keeps two workouts with the same title on one day apart until joined, and does not drop their identical sets', () => {
    const a = 'Gym,"27 Mar 2024, 07:00","27 Mar 2024, 08:00",,Row,,,0,normal,40,10,,,';
    const b = 'Gym,"27 Mar 2024, 19:00","27 Mar 2024, 20:00",,Row,,,0,normal,40,10,,,';
    const p = ok(parseWorkoutCsv(hevy(a, b), 'hevy'));
    expect(p.days[0]!.sets).toHaveLength(2);
    expect(p.skipped.duplicate).toBe(0);
  });

  it('a file pasted twice imports once (same workout, exercise, index, weight, reps)', () => {
    const row = 'Gym,"27 Mar 2024, 07:00","27 Mar 2024, 08:00",,Row,,,0,normal,40,10,,,';
    const p = ok(parseWorkoutCsv(hevy(row, row), 'hevy'));
    expect([p.sets, p.skipped.duplicate]).toEqual([1, 1]);
  });
});

describe('bad files', () => {
  it.each([['', 'empty'], ['   \n ', 'empty'], [STRONG_HEAD, 'empty'], ['a,b,c\n1,2,3', 'not_recognised'], ['{"json": true}', 'not_recognised']])('refuses %j as %s', (text, error) => {
    expect(parseWorkoutCsv(text, 'strong')).toEqual({ ok: false, error });
  });
  it('refuses a file over the size cap and over the row cap', () => {
    expect(parseWorkoutCsv('x'.repeat(IMPORT_MAX_CHARS + 1), 'strong')).toEqual({ ok: false, error: 'too_large' });
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => '2024-03-27 18:30:00,A,Row,1,40,10,0,0,,,');
    expect(parseWorkoutCsv(strong(...rows), 'strong')).toEqual({ ok: false, error: 'too_many_rows' });
  });
  it('refuses a file whose every row is unreadable', () => {
    expect(parseWorkoutCsv(strong('nope,A,Row,1,40,10,0,0,,,'), 'strong')).toEqual({ ok: false, error: 'not_recognised' });
  });
});

describe('exercise matching', () => {
  const catalogue = ['Barbell Bench Press', 'Push-ups', 'Dumbbell Curl', 'Plank (seconds)'];
  it('matches exact, then case-insensitive, then by form', () => {
    expect(matchExercise('Push-ups', catalogue)).toBe('Push-ups');
    expect(matchExercise('push-UPS', catalogue)).toBe('Push-ups');
    expect(matchExercise('Bench Press (Barbell)', catalogue)).toBe('Barbell Bench Press');
    expect(matchExercise('Push Up', catalogue)).toBe('Push-ups');
    expect(matchExercise('Curl (Dumbbell)', catalogue)).toBe('Dumbbell Curl');
  });
  it('does not match a different exercise', () => {
    expect(matchExercise('Bench Press (Dumbbell)', catalogue)).toBeNull();
    expect(matchExercise('Squat', catalogue)).toBeNull();
    expect(matchExercise('!!!', catalogue)).toBeNull();
  });
  it('lists matched and unmatched names once each', () => {
    const days = [{ date: '2024-03-27', title: 'A', sets: [{ exercise: 'Push Up', weightKg: null, reps: 5 }, { exercise: 'Squat', weightKg: 50, reps: 5 }, { exercise: 'Push Up', weightKg: null, reps: 6 }, { exercise: 'Squat', weightKg: 50, reps: 5 }] }];
    expect(matchAll(days, catalogue)).toEqual({ matched: { 'Push Up': 'Push-ups' }, unmatched: ['Squat'] });
  });
});

describe('planImport', () => {
  const days = [
    { date: '2024-03-27', title: 'A', sets: [{ exercise: 'Push Up', weightKg: null, reps: 5 }, { exercise: 'Squat', weightKg: 50, reps: 5 }, { exercise: 'Pushup', weightKg: null, reps: 7 }] },
    { date: '2024-03-28', title: 'B', sets: [{ exercise: 'Squat', weightKg: 60, reps: 5 }] },
    { date: '2024-03-29', title: 'C', sets: [{ exercise: 'Squat', weightKg: 60, reps: 5 }] },
  ];
  it('maps names, numbers sets per exercise after mapping, counts skipped exercises, drops emptied days', () => {
    const plan = planImport(days, { 'Push Up': 'Push-ups', Pushup: 'Push-ups', Squat: null }, new Set());
    expect(plan.days).toEqual([{ date: '2024-03-27', title: 'A', sets: [{ exercise: 'Push-ups', setIndex: 0, weightKg: null, reps: 5 }, { exercise: 'Push-ups', setIndex: 1, weightKg: null, reps: 7 }] }]);
    expect([plan.sets, plan.skippedExercise]).toEqual([2, 3]);
  });
  it('never overwrites a day the app has: it is skipped whole and reported', () => {
    const plan = planImport(days, { 'Push Up': 'Push-ups', Pushup: 'Push-ups', Squat: 'Squat' }, new Set(['2024-03-28', '2024-03-27']));
    expect(plan.days.map((d) => d.date)).toEqual(['2024-03-29']);
    expect(plan.occupied).toEqual(['2024-03-27', '2024-03-28']);
  });
  it('treats an Object.prototype name as unmapped', () => {
    const plan = planImport([{ date: '2024-03-27', title: 'A', sets: [{ exercise: 'constructor', weightKg: 1, reps: 1 }] }], {}, new Set());
    expect(plan.days).toEqual([]);
    expect(plan.skippedExercise).toBe(1);
  });
});
