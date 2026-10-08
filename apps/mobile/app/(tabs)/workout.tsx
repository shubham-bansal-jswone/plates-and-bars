import { useSQLiteContext } from 'expo-sqlite';
import { WorkoutScreen } from '../../src/screens/WorkoutScreen';

export default function Workout() {
  return <WorkoutScreen db={useSQLiteContext()} />;
}
