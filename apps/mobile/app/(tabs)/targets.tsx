import { useDb } from '../../src/db/lockedDb';
import { TargetsScreen } from '../../src/screens/TargetsScreen';
export default function Targets() {
  return <TargetsScreen db={useDb()} />;
}
