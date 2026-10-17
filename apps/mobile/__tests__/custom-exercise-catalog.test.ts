import { exerciseNamed, getCatalog, setCustomTags } from '../src/workout/catalog';

// Custom exercises (Settings.custom_tags, #312) applied to the catalog the app reads; entries can come from sync, so bad
// ones are skipped with the content's own tag rule.
const tag = (o: Record<string, unknown> = {}) => ({ pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: ['quads'], secondary: [], joints: [], ...o });

afterEach(() => setCustomTags({}));

describe('custom exercise tags in the catalog (#312)', () => {
  it('adds a custom exercise with its tags and a meta entry; built-in exercises stay', () => {
    const before = Object.keys(getCatalog().tags).length;
    setCustomTags({ 'Cossack Squat': tag() });
    const c = getCatalog();
    expect(c.tags['Cossack Squat']).toMatchObject({ primary: ['quads'], equipment: 'machine' });
    expect(c.meta['Cossack Squat']).toBeTruthy();
    expect(Object.keys(c.tags)).toHaveLength(before + 1);
    expect(c.tags['Barbell Bench Press']).toBeTruthy();
  });

  it('skips entries that break the tag rule, a prototype name, an overlong or padded name', () => {
    const builtIn = new Set(Object.keys(getCatalog().tags));
    setCustomTags({
      Good: tag(),
      'No main muscle': tag({ primary: [] }),
      'Bad muscle': tag({ primary: ['wings'] }),
      'Bad equipment': tag({ equipment: 'rocket' }),
      constructor: tag(),
      [`${'x'.repeat(201)}`]: tag(),
      ' Padded ': tag(),
      Junk: 'not a tag',
    });
    expect(Object.keys(getCatalog().tags).filter((n) => !builtIn.has(n))).toEqual(['Good']);
  });

  it('the same input is not recomputed; clearing removes the custom exercises', () => {
    const raw = { Mine: tag() };
    setCustomTags(raw);
    const first = getCatalog();
    setCustomTags(raw);
    expect(getCatalog()).toBe(first);
    setCustomTags({});
    expect(getCatalog().tags.Mine).toBeUndefined();
  });
});

describe('a typed exercise name matches in any letter case (decided on #450)', () => {
  it('finds a built-in by any case and returns its own spelling', () => {
    expect(exerciseNamed('goblet squat')).toBe('Goblet Squat');
    expect(exerciseNamed('GOBLET SQUAT')).toBe('Goblet Squat');
    expect(exerciseNamed('Goblet Squat')).toBe('Goblet Squat');
  });

  it('finds a custom exercise by any case', () => {
    expect(exerciseNamed('cossack squat')).toBeUndefined();
    setCustomTags({ 'Cossack Squat': tag() });
    expect(exerciseNamed('cossack SQUAT')).toBe('Cossack Squat');
  });

  it('is letter case only: other spaces and spellings are new names', () => {
    expect(exerciseNamed('goblet  squat')).toBeUndefined();
    expect(exerciseNamed('goblet squats')).toBeUndefined();
    expect(exerciseNamed('')).toBeUndefined();
  });
});
