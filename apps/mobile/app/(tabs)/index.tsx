import { useDb } from '../../src/db/lockedDb';
import { FoodScreen } from '../../src/screens/FoodScreen';

export default function Food() {
  return <FoodScreen db={useDb()} />;
}
