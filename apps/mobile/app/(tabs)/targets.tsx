import { useSQLiteContext } from 'expo-sqlite';
import { TargetsScreen } from '../../src/screens/TargetsScreen';
export default function Targets() {
  return <TargetsScreen db={useSQLiteContext()} />;
}
