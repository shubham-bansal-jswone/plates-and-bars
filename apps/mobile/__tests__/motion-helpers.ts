import fixtureBundle from '../../../tools/exercise-motion/fixtures/squat-synthetic.motion.json';

/** The exercise the synthetic squat fixture is named for. */
export const MOTION_ENTRY_NAME = 'Bodyweight Squat';

/**
 * The committed synthetic squat (tools/exercise-motion/fixtures) with the provenance of a real clip, so the app's validator accepts it
 * in tests. The app refuses `synthetic_fixture`, and the shipped bundle holds no entry.
 */
export function motionFixtureBundle(): unknown {
  const e = fixtureBundle.motions[MOTION_ENTRY_NAME];
  return {
    ...fixtureBundle,
    motions: { [MOTION_ENTRY_NAME]: { ...e, source: 'own_filming', source_id: 'test/squat', licence: 'CC-BY-4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/', author: 'Test Author', note: null } },
  };
}
