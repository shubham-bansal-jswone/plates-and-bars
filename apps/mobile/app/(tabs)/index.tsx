import { useSQLiteContext } from 'expo-sqlite';
import { FoodScreen } from '../../src/screens/FoodScreen';

export default function Food() {
  return <FoodScreen db={useSQLiteContext()} />;
}
