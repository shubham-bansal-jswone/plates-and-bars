import { useDb } from '../../src/db/lockedDb';
import { WorkoutScreen } from '../../src/screens/WorkoutScreen';

export default function Workout() {
  return <WorkoutScreen db={useDb()} />;
}
