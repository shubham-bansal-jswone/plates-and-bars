import { useSQLiteContext } from 'expo-sqlite';
import { ProgressScreen } from '../../src/screens/ProgressScreen';

export default function Progress() {
  return <ProgressScreen db={useSQLiteContext()} />;
}
