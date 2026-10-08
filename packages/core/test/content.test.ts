import content from '../../../content/exercises.json';
import { applyFocus, mapForWhere, sessionSets, TEMPLATES, type ExerciseCatalog } from '../src/index';
import { goldenCatalog } from './prototype-plan';

// content/exercises.json is passed to the session functions as is; this assignment is the type check.
const fromContent: ExerciseCatalog = content;
const golden = goldenCatalog();

describe('content/exercises.json against golden/exercises.json', () => {
  it('tags equal the renamed golden tags, key order included', () => {
    expect(fromContent.tags).toEqual(golden.tags);
    // focusPick breaks ties by tag order, so exercise order and field order must match too.
    expect(JSON.stringify(fromContent.tags)).toBe(JSON.stringify(golden.tags));
  });

  it('away map equals the golden away map, key order included', () => {
    expect(fromContent.away_map.dumbbells_bodyweight).toEqual(golden.away_map.dumbbells_bodyweight);
    expect(JSON.stringify(fromContent.away_map)).toBe(JSON.stringify(golden.away_map));
  });

  it('builds the same sessions from content as from golden', () => {
    const state = { profile: { minutes: 45 }, focus: ['abs', 'glutes'] };
    for (const t of Object.keys(TEMPLATES))
      for (const where of ['gym', 'dumbbells', 'bodyweight'] as const) {
        const its = (c: ExerciseCatalog) => applyFocus(mapForWhere(TEMPLATES[t] as string[], where, c).map((name) => ({ name })), t, where, state, c);
        expect(its(fromContent)).toEqual(its(golden));
        expect(sessionSets(its(fromContent), { date: '2026-10-08', tags: fromContent.tags, focus: state.focus })).toEqual(sessionSets(its(golden), { date: '2026-10-08', tags: golden.tags, focus: state.focus }));
      }
  });
});
