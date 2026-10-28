import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/Sheet';
import { Button, COLUMN_MAX, Chip, Field, Heading, Hint } from '../components/ui';
import { getLibrary } from '../library/exercises';
import { useTheme } from '../theme/useTheme';
import { type } from '../theme/tokens';
import { IMPORT_COPY as t } from './copy';

/** At most this many names are drawn at once: the search narrows the rest (a small phone, a long library). */
const SHOWN = 40;

/** A sheet to pick one library exercise (built-in and the user's own) for an imported name. */
export function ExercisePicker({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const all = getLibrary().filter((x) => needle === '' || x.name.toLowerCase().includes(needle));
  return (
    <SheetModal title={t.pickerTitle} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Heading level={2} style={[type.heading, { color: c.ink }]}>
            {t.pickerTitle}
          </Heading>
          <Field label={t.pickerSearch} value={q} onChangeText={setQ} autoCapitalize="none" />
          {all.length === 0 ? <Hint>{t.pickerNone}</Hint> : null}
          <View style={styles.chips}>
            {all.slice(0, SHOWN).map((x) => (
              <Chip key={x.name} label={t.pickerPick(x.name)} text={x.name} onPress={() => onPick(x.name)} />
            ))}
          </View>
          {all.length > SHOWN ? <Hint>{`Showing ${SHOWN} of ${all.length}. Type to narrow the list.`}</Hint> : null}
          <Button label={t.pickerClose} kind="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center' },
  body: { width: '100%', maxWidth: COLUMN_MAX, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
