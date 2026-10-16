import cardsContent from '../../../content/cards.json';
import { addDays, dailyRead, learnList, type LearnCard } from '../src/index';
import { loadGolden } from './helpers';
import { loadLearn, protoDaily } from './prototype-learn';

// golden/learn.json (generated from the prototype's `learnCardHtml`), then differential and hand-worked cases.
const proto = loadLearn();
const cards: readonly LearnCard[] = cardsContent.cards;
const HIDDEN = ['ramp', 'ladder', 'formfirst']; // the app's held-back cards (#212)
const START = '2026-10-01';
const ids = (cs: readonly LearnCard[]) => cs.map((c) => c.id);

/** Runs prototype `learnCardHtml` for a sex, a stored `learn` (or none) and a day. */
function protoRun(sex: string | undefined, learn: { start: string; read: string[] } | undefined, today: string) {
  proto.S.settings = sex === undefined ? {} : { profile: { sex } };
  if (learn) proto.S.settings.learn = { start: learn.start, read: [...learn.read] };
  proto.setToday(today);
  return protoDaily(proto.learnCardHtml());
}

/** The prototype's full order for a sex: the card it offers on a late day, read one by one. */
function protoOrder(sex: string | undefined): string[] {
  const read: string[] = [];
  for (let r = protoRun(sex, { start: START, read }, '2027-10-01'); r; r = protoRun(sex, { start: START, read }, '2027-10-01')) read.push(r.next);
  return read;
}

interface GoldenLearn {
  order: Record<'male' | 'female' | 'none', string[]>;
  cases: { id: string; input: { sex: string | null; days: number; read: string[] }; output: { due: number; next: string | null; readN?: number; total?: number } }[];
}
const golden = loadGolden<GoldenLearn>('learn');

// The fixture has no hidden cards (an app filter, #212) and no future starts (#584 is a decided exception to the prototype).
describe('learn: golden/learn.json', () => {
  it.each(['male', 'female', 'none'] as const)('order for %s', (key) => {
    expect(ids(learnList(cards, key === 'none' ? undefined : key))).toEqual(golden.order[key]);
  });
  it.each(golden.cases.map((c) => [c.id, c] as const))('%s', (_id, { input, output }) => {
    const sex = input.sex ?? undefined;
    const c = dailyRead(cards, sex, { start: START, read: input.read }, addDays(START, input.days));
    expect(c.next?.id ?? null).toBe(output.next);
    // The prototype shows no progress line when nothing is due, so readN and total are recorded only with a card.
    if (output.next !== null) expect({ readN: c.readN, total: c.total }).toEqual({ readN: output.readN, total: output.total });
    // `due` is the number of leading cards of the list that are due: the card offered is the first unread one among them.
    const list = ids(learnList(cards, sex));
    expect(list.slice(0, output.due).find((id) => !input.read.includes(id)) ?? null).toBe(output.next);
  });
  it('covers days 0, 2, 3, 6 and 30 for each sex', () => {
    for (const sex of ['male', 'female', null]) expect([...new Set(golden.cases.filter((c) => c.input.sex === sex).map((c) => c.input.days))]).toEqual([0, 2, 3, 6, 12, 30]);
    expect(golden.cases.filter((c) => c.input.sex === 'male' && c.input.read.length === 0).map((c) => c.output.due)).toEqual([1, 1, 2, 3, 5, 11]);
  });
});

describe('learnList (prototype LEARN and the list in learnCardHtml)', () => {
  it('content order gives the prototype list for each sex', () => {
    expect(ids(learnList(cards, 'male'))).toEqual(proto.LEARN);
    expect(protoOrder('male')).toEqual(proto.LEARN);
    expect(ids(learnList(cards, 'female'))).toEqual(protoOrder('female'));
    expect(ids(learnList(cards, 'female'))).toEqual([...proto.LEARN.slice(0, 6), 'bulky', ...proto.LEARN.slice(6)]);
    expect(ids(learnList(cards, undefined))).toEqual(protoOrder(undefined));
    expect(ids(learnList(cards, 'other'))).toEqual(proto.LEARN);
  });
  it('leaves hidden cards out after the splice, so bulky lands between overload and spot', () => {
    expect(ids(learnList(cards, 'male', HIDDEN))).toEqual(['rir', 'protein', 'scale', 'overload', 'spot', 'sleep', 'volume', 'deload', 'soreness', 'creatine']);
    expect(ids(learnList(cards, 'female', HIDDEN))).toEqual(['rir', 'protein', 'scale', 'overload', 'bulky', 'spot', 'sleep', 'volume', 'deload', 'soreness', 'creatine']);
  });
  it('ignores a null order, and an insert index or audience on its own', () => {
    const cs: LearnCard[] = [
      { id: 'b', learn_order: 1 },
      { id: 'a', learn_order: 0 },
      { id: 'x', learn_order: null },
      { id: 'y', learn_insert_at: 1 },
      { id: 'z', audience: 'female' },
      { id: 'w', audience: 'female', learn_insert_at: 1 },
    ];
    expect(ids(learnList(cs, 'female'))).toEqual(['a', 'w', 'b']);
    expect(ids(learnList(cs, 'male'))).toEqual(['a', 'b']);
    expect(learnList([], 'male')).toEqual([]);
  });
});

describe('dailyRead (prototype learnCardHtml)', () => {
  const firsts = proto.LEARN.slice(0, 3);
  const reads: Record<string, string[]> = {
    none: [],
    first: [proto.LEARN[0] as string],
    second: [proto.LEARN[1] as string],
    firstThree: firsts,
    bulky: ['bulky'],
    notInList: ['targets', 'fibre'],
    allButLast: proto.LEARN.slice(0, -1),
    all: [...proto.LEARN, 'bulky'],
  };
  // Non-future starts only: a start after today is a decided exception (#584), tested below.
  const offsets = [0, 1, 2, 3, 5, 6, 17, 18, 21, 30, 33, 36, 100];
  const grid = ['male', 'female', undefined].flatMap((sex) =>
    Object.keys(reads).flatMap((r) => offsets.map((o) => [sex ?? 'no profile', r, o] as const)),
  );
  it.each(grid)('matches the prototype: %s, read %s, day %i', (sexLabel, r, o) => {
    const sex = sexLabel === 'no profile' ? undefined : sexLabel;
    const read = reads[r] as string[];
    const today = addDays(START, o);
    const p = protoRun(sex, { start: START, read }, today);
    const c = dailyRead(cards, sex, { start: START, read }, today);
    expect(c.next?.id ?? null).toBe(p?.next ?? null);
    if (p) expect({ readN: c.readN, total: c.total }).toEqual({ readN: p.readN, total: p.total });
  });
  it('an unset start counts from today, as the prototype starts the clock on first show', () => {
    for (const sex of ['male', 'female']) {
      const c = dailyRead(cards, sex, { start: null, read: [] }, START);
      expect(c.next?.id).toBe(protoRun(sex, undefined, START)?.next);
      expect(proto.S.settings.learn?.start).toBe(START);
      // Only the first card is due on the first day, so with it read there is nothing more.
      const first = [proto.LEARN[0] as string];
      expect(dailyRead(cards, sex, { start: null, read: first }, START).next).toBeNull();
      expect(protoRun(sex, { start: START, read: first }, START)).toBeNull();
    }
  });

  // Hand-worked (issue #552): hidden cards excluded, days 0, 2, 3, 6 and 30, nothing read.
  it.each([
    ['male', 0, 'rir', 10],
    ['male', 2, 'rir', 10],
    ['male', 3, 'rir', 10],
    ['male', 6, 'rir', 10],
    ['male', 30, 'rir', 10],
    ['female', 0, 'rir', 11],
    ['female', 30, 'rir', 11],
  ])('hidden excluded, %s day %i: next %s of %i', (sex, day, next, total) => {
    const c = dailyRead(cards, sex, { start: START, read: [] }, addDays(START, day), HIDDEN);
    expect({ next: c.next?.id, readN: c.readN, total: c.total }).toEqual({ next, readN: 0, total });
  });
  // 1 + floor(days / 3) cards are due; with the first two read, the third shows only once three are due (day 6).
  it.each([
    ['male', 0, null],
    ['male', 2, null],
    ['male', 3, null],
    ['male', 5, null],
    ['male', 6, 'scale'],
    ['male', 30, 'scale'],
    ['female', 0, null],
    ['female', 3, null],
    ['female', 6, 'scale'],
    ['female', 30, 'scale'],
  ])('hidden excluded, %s day %i with rir and protein read: next %s', (sex, day, next) => {
    const c = dailyRead(cards, sex, { start: START, read: ['rir', 'protein'] }, addDays(START, day), HIDDEN);
    expect(c.next?.id ?? null).toBe(next);
    expect(c.readN).toBe(2);
  });
  it('hidden excluded: with all but bulky read, a woman gets bulky once 5 are due (day 12), a man nothing', () => {
    const read = ['rir', 'protein', 'scale', 'overload', 'spot', 'sleep'];
    expect(dailyRead(cards, 'female', { start: START, read }, addDays(START, 11), HIDDEN).next).toBeNull();
    expect(dailyRead(cards, 'female', { start: START, read }, addDays(START, 12), HIDDEN).next?.id).toBe('bulky');
    expect(dailyRead(cards, 'male', { start: START, read }, addDays(START, 12), HIDDEN).next).toBeNull();
  });
  it('the due list is capped at the list length; all read gives no card', () => {
    const list = ids(learnList(cards, 'male', HIDDEN));
    const allButLast = list.filter((id) => id !== 'creatine');
    expect(dailyRead(cards, 'male', { start: '2026-01-01', read: allButLast }, '2026-10-01', HIDDEN).next?.id).toBe('creatine');
    const all = dailyRead(cards, 'male', { start: '2026-01-01', read: list }, '2026-10-01', HIDDEN);
    expect(all).toEqual({ next: null, readN: 10, total: 10 });
    expect(dailyRead([], 'male', { start: null, read: [] }, START)).toEqual({ next: null, readN: 0, total: 0 });
  });
  // Decided exception (#584, decided: clamp): the prototype gives 0 due 1 to 3 days ahead and slices cards off the end further
  // ahead. Core treats a future start as today; the prototype follows in the next spec-change batch.
  it.each([-1, -2, -3, -4, -6, -7, -30])('decided (#584): a start %i days after today counts as today, so 1 card is due', (o) => {
    const today = addDays(START, o);
    for (const sex of ['male', 'female', undefined]) {
      const asToday = dailyRead(cards, sex, { start: today, read: [] }, today);
      expect(dailyRead(cards, sex, { start: START, read: [] }, today)).toEqual(asToday);
      expect(asToday.next?.id).toBe(proto.LEARN[0]);
      expect(dailyRead(cards, sex, { start: START, read: [proto.LEARN[0] as string] }, today).next).toBeNull();
    }
    expect(dailyRead(cards, 'male', { start: START, read: [] }, today, HIDDEN).next?.id).toBe('rir');
  });
  it('decided (#584): the prototype still differs for a future start (remove once it follows)', () => {
    expect(protoRun('male', { start: START, read: [] }, addDays(START, -1))).toBeNull();
    expect(protoRun('male', { start: START, read: [] }, addDays(START, -6))?.next).toBe(proto.LEARN[0]);
  });
});
