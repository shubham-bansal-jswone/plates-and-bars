import { bodyweightOn, type WeighIn } from '../src';

const w = (date: string, weight_kg: number, deleted_at: string | null = null): WeighIn => ({ date, weight_kg, deleted_at });

describe('bodyweightOn (#1404)', () => {
  const ws = [w('2026-10-01', 70), w('2026-10-05', 72), w('2026-10-09', 99), w('2026-10-06', 50, '2026-10-06T00:00:00Z')];

  it('picks the latest weigh-in on or before the date', () => {
    expect(bodyweightOn(ws, '2026-10-05', 82)).toBe(72);
    expect(bodyweightOn(ws, '2026-10-03', 82)).toBe(70);
  });
  it('ignores later and deleted weigh-ins', () => {
    expect(bodyweightOn(ws, '2026-10-08', 82)).toBe(72);
  });
  it('falls back to the profile weight', () => {
    expect(bodyweightOn(ws, '2026-09-30', 82)).toBe(82);
    expect(bodyweightOn([], '2026-10-08', 82)).toBe(82);
  });
  it('is null with neither', () => {
    expect(bodyweightOn([], '2026-10-08', undefined)).toBeNull();
    expect(bodyweightOn([], '2026-10-08', null)).toBeNull();
    expect(bodyweightOn([], '2026-10-08')).toBeNull();
  });
  it('treats a zero or negative profile weight as invalid (null)', () => {
    expect(bodyweightOn([], '2026-10-08', 0)).toBeNull();
    expect(bodyweightOn([], '2026-10-08', -5)).toBeNull();
    expect(bodyweightOn(ws, '2026-10-08', 0)).toBe(72); // a weigh-in still wins
  });
});
