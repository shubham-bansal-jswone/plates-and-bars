import { useLocalSearchParams } from 'expo-router';
import { SetupScreen } from '../src/screens/SetupScreen';
export default function Setup() {
  const { recalc, weight } = useLocalSearchParams<{ recalc?: string; weight?: string }>();
  return <SetupScreen recalc={recalc === '1'} weight={weight} />;
}
