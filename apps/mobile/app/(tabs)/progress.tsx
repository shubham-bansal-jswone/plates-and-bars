import { useDb } from '../../src/db/lockedDb';
import { ProgressScreen } from '../../src/screens/ProgressScreen';

export default function Progress() {
  return <ProgressScreen db={useDb()} />;
}
