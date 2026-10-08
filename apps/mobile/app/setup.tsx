import { useLocalSearchParams } from 'expo-router';
import { SetupScreen } from '../src/screens/SetupScreen';
export default function Setup() {
  const { recalc } = useLocalSearchParams<{ recalc?: string }>();
  return <SetupScreen recalc={recalc === '1'} />;
}
