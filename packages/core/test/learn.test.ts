import cardsContent from '../../../content/cards.json';
import { addDays, dailyRead, learnList, type LearnCard } from '../src/index';
import { loadLearn, protoDaily } from './prototype-learn';

// Hand-worked cases until the golden generator lands (#99); every other case runs the prototype's own `learnCardHtml`.
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
  const offsets = [-7, -6, -4, -3, -2, -1, 0, 1, 2, 3, 5, 6, 17, 18, 21, 30, 33, 36, 100];
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
  it('PINNED QUIRK: a start after today gives 0 due, or a negative count that slices cards off the end', () => {
    // 1 to 3 days ahead: 1 + floor(-1/3) = 0 due, no card. 6 days ahead: -1, and slice(0, -1) offers the first unread card.
    expect(dailyRead(cards, 'male', { start: START, read: [] }, addDays(START, -1)).next).toBeNull();
    expect(dailyRead(cards, 'male', { start: START, read: [] }, addDays(START, -6)).next?.id).toBe('formfirst');
    expect(protoRun('male', { start: START, read: [] }, addDays(START, -6))?.next).toBe('formfirst');
    expect(dailyRead(cards, 'male', { start: START, read: proto.LEARN.slice(0, -1) }, addDays(START, -6)).next).toBeNull();
  });
});
