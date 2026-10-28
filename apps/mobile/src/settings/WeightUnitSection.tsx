import { View } from 'react-native';
import { Chip, Hint, Label } from '../components/ui';
import type { WeightUnit } from '@plate-and-bar/core';
import { useWeightUnit } from './weightUnit';

/** Targets tab: the unit weights are shown and typed in. Switching changes the display only; stored weights stay kg. */
/** `onSwitch` runs with the old and new unit, so a screen holding typed weight text can convert it (Setup). */
export function WeightUnitSection({ onSwitch }: { onSwitch?: (from: WeightUnit, to: WeightUnit) => void } = {}) {
  const { unit, setUnit } = useWeightUnit();
  const pick = (to: WeightUnit) => {
    if (to !== unit) onSwitch?.(unit, to);
    setUnit(to);
  };
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Label>Weight unit</Label>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Show weights in kilograms" text="kg" pressed={unit === 'kg'} onPress={() => pick('kg')} />
        <Chip label="Show weights in pounds" text="lb" pressed={unit === 'lb'} onPress={() => pick('lb')} />
      </View>
      <Hint>Changes how weights show and what you type. Your saved weights are not changed.</Hint>
    </View>
  );
}
