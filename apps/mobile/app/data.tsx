import { DataScreen } from '../src/screens/DataScreen';
import { useDb } from '../src/db/lockedDb';
export default function Data() {
  return <DataScreen db={useDb()} />;
}
