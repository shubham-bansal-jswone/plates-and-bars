import { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useBottomInset } from '../components/bottomInset';
import { a11yState, Button, COLUMN_MAX, Chip, Field, H1, Hint, Label, layout, Press } from '../components/ui';
import { useOptionalSettings } from '../state/SettingsProvider';
import { radius, space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ExerciseFigure, hasFigure } from '../workout/ExerciseFigure';
import { ExerciseDetail, type SessionTarget } from './ExerciseDetail';
import { equipmentLabel, filterLibrary, getEquipment, getLibrary, getMuscles, getTypes, isFiltered, muscleLabel, NO_FILTER, typeLabel, type LibraryExercise, type LibraryFilter } from './exercises';

/** The search field never gets narrower than this, so Filters (44px+ target) wraps below it on a phone and sits beside it on a wider screen. */
const SEARCH_MIN = 300;

/** An outlined rounded tile with a bold label: one filter value. Radio semantics, lime only when selected. */
function Tile({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={label}
      {...a11yState({ checked: selected })}
      onPress={onPress}
      style={[styles.tile, { borderColor: selected ? c.brand : c.line, backgroundColor: selected ? c.brand : c.surface }]}
    >
      <Text style={[type.buttonSm, { color: selected ? c.onBrand : c.ink }]}>{label}</Text>
    </Press>
  );
}

function Tiles<T extends string>({ title, values, label, value, onChange }: { title: string; values: readonly T[]; label: (v: T) => string; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{title}</Label>
      <View accessibilityRole="radiogroup" accessibilityLabel={`${title} filter`} style={layout.row}>
        <Tile label="All" selected={value === null} onPress={() => onChange(null)} />
        {values.map((v) => (
          <Tile key={v} label={label(v)} selected={value === v} onPress={() => onChange(v)} />
        ))}
      </View>
    </View>
  );
}

/** 56 dp drawing, or a neutral tile naming the first main muscle when the exercise has none. */
function Thumb({ e }: { e: LibraryExercise }) {
  const c = useTheme();
  if (hasFigure(e.name)) return <ExerciseFigure name={e.name} size="thumb" />;
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.thumb, { backgroundColor: c.surfaceSoft }]}>
      <Text numberOfLines={2} style={[type.small, { color: c.muted, textAlign: 'center' }]}>{e.primary[0] ? muscleLabel(e.primary[0]) : ''}</Text>
    </View>
  );
}

function Row({ e, onOpen }: { e: LibraryExercise; onOpen: () => void }) {
  const c = useTheme();
  const sub = `${equipmentLabel(e.equipment)} · ${e.primary.map(muscleLabel).join(', ')}`;
  return (
    <Press accessibilityRole="button" onPress={onOpen} style={[styles.row, { backgroundColor: c.surface }]}>
      <Thumb e={e} />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: c.ink }]}>{e.name}</Text>
        <Text style={[type.caption, { color: c.muted }]}>{sub}</Text>
      </View>
    </Press>
  );
}

/** Browse the exercise content: search by name, filter by equipment, main muscle and type, open one for its drawing and notes. Works offline. */
export function ExerciseLibraryScreen({ onBack, list: given, session }: { onBack: () => void; list?: readonly LibraryExercise[]; session?: SessionTarget }) {
  const c = useTheme();
  const bottom = useBottomInset();
  // Reading the settings re-renders this screen when custom exercises change; getLibrary then rebuilds its list for the new catalog.
  useOptionalSettings();
  const list = given ?? getLibrary();
  const [f, setF] = useState<LibraryFilter>(NO_FILTER);
  const [open, setOpen] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shown = useMemo(() => filterLibrary(list, f), [list, f]);
  const picked = open ? list.find((e) => e.name === open) : undefined;
  // Android hardware back closes the detail and returns to the list.
  useEffect(() => {
    if (!picked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [picked]);
  const active: [keyof LibraryFilter & ('equipment' | 'muscle' | 'type'), string][] = [];
  if (f.equipment) active.push(['equipment', equipmentLabel(f.equipment)]);
  if (f.muscle) active.push(['muscle', muscleLabel(f.muscle)]);
  if (f.type) active.push(['type', typeLabel(f.type)]);
  if (picked) return <ExerciseDetail exercise={picked} onBack={() => setOpen(null)} {...(session ? { session } : {})} />;
  return (
    <FlatList
      role="main"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.lg + bottom, width: '100%', maxWidth: COLUMN_MAX + 2 * space.lg, alignSelf: 'center', gap: space.sm }}
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
          {/* Search and Filters share a row when there is room (search takes what is left); on a phone Filters wraps below. */}
          <View style={styles.searchRow}>
            <Field label="Search exercises" placeholder="Search exercises" value={f.query} onChangeText={(query) => setF({ ...f, query })} autoCorrect={false} style={styles.search} />
            <Button label={filtersOpen ? 'Hide filters' : 'Filters'} kind="ghost" expanded={filtersOpen} onPress={() => setFiltersOpen(!filtersOpen)} />
          </View>
          {active.length ? (
            <View style={layout.row}>
              {active.map(([key, text]) => (
                <Chip key={key} pressed label={`Remove ${text} filter`} text={`${text}  ×`} onPress={() => setF({ ...f, [key]: null })} />
              ))}
            </View>
          ) : null}
          {filtersOpen ? (
            <View style={{ gap: space.md }}>
              <Tiles title="Equipment" values={getEquipment()} label={equipmentLabel} value={f.equipment} onChange={(equipment) => setF({ ...f, equipment })} />
              <Tiles title="Muscle" values={getMuscles()} label={muscleLabel} value={f.muscle} onChange={(muscle) => setF({ ...f, muscle })} />
              <Tiles title="Type" values={getTypes()} label={typeLabel} value={f.type} onChange={(t) => setF({ ...f, type: t })} />
            </View>
          ) : null}
          {isFiltered(f) ? <Button label="Clear filters" kind="ghost" onPress={() => setF(NO_FILTER)} /> : null}
          {/* One polite status line: the count, or the no-match message. It is the only place that message shows, so it is read once. */}
          <View testID="library-status" role="status" accessibilityLiveRegion="polite">
            <Hint>{shown.length ? `${shown.length} of ${list.length} exercises` : 'No exercises match. Try fewer filters or a different word.'}</Hint>
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'flex-end' },
  search: { borderRadius: radius.full, paddingHorizontal: 20, flexGrow: 1, flexShrink: 1, flexBasis: SEARCH_MIN, minWidth: SEARCH_MIN },
  tile: { borderWidth: 1, borderRadius: radius.lg, minHeight: 44, paddingHorizontal: space.lg, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, minHeight: 80 },
  thumb: { width: 56, height: 56, borderRadius: 12, padding: 4, alignItems: 'center', justifyContent: 'center' },
});
