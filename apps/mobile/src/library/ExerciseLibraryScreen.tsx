import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Choice, Field, H1, Hint, Label, layout, Press } from '../components/ui';
import { space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ExerciseDetail } from './ExerciseDetail';
import { EQUIPMENT, equipmentLabel, filterLibrary, isFiltered, LIBRARY, muscleLabel, MUSCLES, NO_FILTER, typeLabel, TYPES, type LibraryExercise, type LibraryFilter } from './exercises';

function Chips<T extends string>({ title, values, label, value, onChange }: { title: string; values: readonly T[]; label: (v: T) => string; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{title}</Label>
      <View accessibilityRole="radiogroup" accessibilityLabel={`${title} filter`} style={layout.row}>
        {values.map((v) => (
          <Choice key={v} chip label={label(v)} selected={value === v} onPress={() => onChange(value === v ? null : v)} />
        ))}
      </View>
    </View>
  );
}

function Row({ e, onOpen }: { e: LibraryExercise; onOpen: () => void }) {
  const c = useTheme();
  const sub = `${equipmentLabel(e.equipment)} · ${e.primary.map(muscleLabel).join(', ')}`;
  return (
    <Press accessibilityRole="button" accessibilityLabel={`${e.name}. ${sub}`} onPress={onOpen} style={{ minHeight: 56, justifyContent: 'center', paddingVertical: 8 }}>
      <Text style={[type.bodyStrong, { color: c.ink }]}>{e.name}</Text>
      <Text style={[type.caption, { color: c.body }]}>{sub}</Text>
    </Press>
  );
}

/** Browse the exercise content: search by name, filter by equipment, main muscle and type, open one for its notes. Works offline; no photos. */
export function ExerciseLibraryScreen({ onBack, list = LIBRARY }: { onBack: () => void; list?: readonly LibraryExercise[] }) {
  const c = useTheme();
  const [f, setF] = useState<LibraryFilter>(NO_FILTER);
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => filterLibrary(list, f), [list, f]);
  const picked = open ? list.find((e) => e.name === open) : undefined;
  if (picked) return <ExerciseDetail exercise={picked} onBack={() => setOpen(null)} />;
  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center', gap: 4 }}
      data={shown}
      keyExtractor={(e) => e.name}
      initialNumToRender={15}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <Row e={item} onOpen={() => setOpen(item.name)} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm }}>
          <Button label="Back" kind="link" onPress={onBack} />
          <H1>Exercise library</H1>
          <Field label="Search exercises" placeholder="Search exercises" value={f.query} onChangeText={(query) => setF({ ...f, query })} autoCorrect={false} />
          <Chips title="Equipment" values={EQUIPMENT} label={equipmentLabel} value={f.equipment} onChange={(equipment) => setF({ ...f, equipment })} />
          <Chips title="Muscle" values={MUSCLES} label={muscleLabel} value={f.muscle} onChange={(muscle) => setF({ ...f, muscle })} />
          <Chips title="Type" values={TYPES} label={typeLabel} value={f.type} onChange={(t) => setF({ ...f, type: t })} />
          {isFiltered(f) ? <Button label="Clear filters" kind="ghost" onPress={() => setF(NO_FILTER)} /> : null}
          <Hint>{`${shown.length} of ${list.length} exercises`}</Hint>
        </View>
      }
      ListEmptyComponent={<Hint>No exercises match. Try fewer filters or a different word.</Hint>}
    />
  );
}
