import { View } from 'react-native';
import { Chip, Hint, Label } from '../components/ui';
import { useWeightUnit } from './weightUnit';

/** Targets tab: the unit weights are shown and typed in. Switching changes the display only; stored weights stay kg. */
export function WeightUnitSection() {
  const { unit, setUnit } = useWeightUnit();
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Label>Weight unit</Label>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Show weights in kilograms" text="kg" pressed={unit === 'kg'} onPress={() => setUnit('kg')} />
        <Chip label="Show weights in pounds" text="lb" pressed={unit === 'lb'} onPress={() => setUnit('lb')} />
      </View>
      <Hint>Changes how weights show and what you type. Your saved weights are not changed.</Hint>
    </View>
  );
}
