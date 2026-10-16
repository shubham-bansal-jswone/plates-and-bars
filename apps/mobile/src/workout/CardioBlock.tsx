import { Card, Heading, Hint } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { CardioField } from './CardioField';

/** Prototype `renderWorkout` Cardio block: shown on every Workout view (rest day, planned day, started session), as the prototype does. */
export function CardioBlock({ value, onSave }: { value: number | null; onSave: (text: string) => void }) {
  const c = useTheme();
  return (
    <Card>
      <Heading level={3} style={{ color: c.ink, fontWeight: '700', fontSize: 16 }}>Cardio</Heading>
      <CardioField value={value} onSave={onSave} />
      <Hint>minutes (walk, cycle, incline treadmill)</Hint>
    </Card>
  );
}
