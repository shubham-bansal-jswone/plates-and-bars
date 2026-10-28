import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { DEFAULT_BAR, DEFAULT_PLATES, describePlates, formatWeight, loadableNeighbours, parseWeightInput, type PlateLoad } from '@plate-and-bar/core';
import { SheetModal } from '../components/Sheet';
import { Text } from '../components/Text';
import { Input } from '../components/Input';
import { a11yState, Button, Caption, Chip, Disclosure, ErrorText, Heading, Hint, Label, Press } from '../components/ui';
import { BAR_MAX, usePlateSettings } from '../settings/plateSettings';
import { useWeightUnit } from '../settings/weightUnit';
import { tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** Block colours by plate rank (largest first), the usual bar-loading palette; text on them is always dark. The number is printed on every block, so colour never carries the size alone. */
const BLOCK = ['#E5533D', '#4C8DDB', '#F2C94C', '#5BBF7A', '#F2F2F2', '#C28FE0', '#9AA5B1', '#F2A65A'];
const MAX_BLOCKS = 24;

/** Per-side plates as coloured blocks, tallest nearest the bar. Hidden from screen readers: the plain-text `describePlates` line under it says the same, once. */
function PlateStack({ load }: { load: PlateLoad }) {
  const c = useTheme();
  const biggest = Math.max(...load.perSide.map((p) => p.plate), 1);
  const ranked = [...DEFAULT_PLATES[load.unit]].sort((a, b) => b - a);
  const blocks = load.perSide.flatMap((p) => Array.from({ length: p.count }, () => p.plate)).slice(0, MAX_BLOCKS);
  return (
    <View testID="plate-stack" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
      <View aria-hidden style={[styles.bar, { backgroundColor: c.muted }]} />
      {blocks.map((p, i) => {
        const rank = Math.max(0, ranked.indexOf(p));
        return (
          <View
            key={i}
            aria-hidden
            style={[styles.block, { height: 34 + Math.round(46 * (p / biggest)), backgroundColor: BLOCK[rank % BLOCK.length], borderColor: c.ink }]}
          >
            <Text style={[styles.blockText, tabular]}>{p}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** The bar weight typed as one plain number (0 to `BAR_MAX`, in the display unit), else null. */
function barValue(t: string): number | null {
  const n = t.trim() === '' || parseWeightInput(t) === null ? NaN : Number(t.replace(',', '.'));
  return Number.isFinite(n) && n <= BAR_MAX ? n : null;
}

/**
 * The plate calculator (#1176; an app addition, the rule is core's `platesFor`): which plates go on each side of the bar for a target
 * weight, in the display unit. `targetKg` is the row's typed weight or its suggestion (kg, as stored), or null from the Library where
 * the weight is typed here. When the target is not loadable the nearest weight below and above are offered, and `onApply` (set
 * rows only) writes the chosen one back as exact kg.
 */
export function PlateSheet({ name, targetKg, onApply, onClose }: { name: string; targetKg: number | null; onApply?: (kg: number) => void; onClose: () => void }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
  const { settings, set } = usePlateSettings();
  const mine = settings[unit];
  const [text, setText] = useState(targetKg === null ? '' : formatWeight(targetKg, unit));
  const [barText, setBarText] = useState(String(mine.bar));
  const target = parseWeightInput(text.trim() === '' ? 'x' : text, unit);
  const opts = { unit, bar: mine.bar, plates: mine.plates };
  const nb = target === null ? null : loadableNeighbours(target, opts);
  const load = nb?.below ?? null;
  const exact = !!nb && nb.below.remainder === 0;
  const bad = text.trim() !== '' && target === null;
  const all = DEFAULT_PLATES[unit];
  const barBad = barValue(barText) === null;
  const noPlates = mine.plates.length === 0;

  const togglePlate = (p: number) => {
    const next = mine.plates.includes(p) ? mine.plates.filter((x) => x !== p) : all.filter((x) => x === p || mine.plates.includes(x));
    set(unit, { bar: mine.bar, plates: next });
  };
  const saveBar = (t: string) => {
    setBarText(t);
    const bar = barValue(t);
    if (bar !== null) set(unit, { bar, plates: mine.plates }); // only what the store reads back is written
  };
  const apply = (l: PlateLoad) => {
    onApply?.(l.loadedKg);
    onClose();
  };

  return (
    <SheetModal title={`Plates for ${name}`} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{`Plates for ${name}`}</Heading>
            </View>
            <Button label="Close" a11yLabel={`Close plates for ${name}`} kind="link" onPress={onClose} />
          </View>

          <View style={{ gap: 6 }}>
            <Label>{`Target weight (${unit})`}</Label>
            <Input accessibilityLabel={`Target weight in ${unit}`} inputMode="decimal" value={text} onChangeText={setText} invalid={bad} />
            {bad ? <ErrorText>Type one number, like 100.</ErrorText> : null}
          </View>

          {load && !noPlates ? (
            <View style={{ gap: 10 }}>
              <PlateStack load={load} />
              <Text style={[type.bodyStrong, { color: c.ink }]}>{describePlates(load)}</Text>
              <Text style={[type.textBody, tabular, { color: c.body }]}>
                {`Loaded: ${load.loadedTotal} ${unit}. `}
                {exact ? 'Exactly the target.' : load.belowBar ? `Lighter than the bar (${mine.bar} ${unit}).` : `${Math.abs(load.remainder)} ${unit} short of the target.`}
              </Text>
              {!exact && nb && !load.belowBar ? (
                <View style={{ gap: 8 }}>
                  <Hint>The target can’t be loaded with these plates. Nearest you can load:</Hint>
                  {([['below', nb.below], ['above', nb.above]] as const).map(([k, l]) => (
                    <View key={k} style={styles.near}>
                      <Text style={[type.textBody, tabular, { color: c.ink, flex: 1 }]}>{`${k === 'below' ? 'Below' : 'Above'}: ${l.loadedTotal} ${unit}`}</Text>
                      {onApply ? <Button label={`Use ${l.loadedTotal} ${unit}`} a11yLabel={`Use ${l.loadedTotal} ${unit}, ${k} the target, on this set`} kind="ghost" onPress={() => apply(l)} /> : null}
                    </View>
                  ))}
                </View>
              ) : null}
              {load.belowBar && onApply ? <Button label={`Use ${load.loadedTotal} ${unit}`} a11yLabel={`Use ${load.loadedTotal} ${unit}, the bar only, on this set`} kind="ghost" onPress={() => apply(load)} /> : null}
              {exact && onApply ? <Button label={`Use ${load.loadedTotal} ${unit}`} a11yLabel={`Use ${load.loadedTotal} ${unit} on this set`} onPress={() => apply(load)} /> : null}
            </View>
          ) : (
            bad ? null : <Hint>{noPlates ? 'Turn on at least one plate below.' : 'Type a weight to see the plates.'}</Hint>
          )}

          <Disclosure label="Bar and plates" a11yLabel="Bar and plates settings">
            <View style={{ gap: 6 }}>
              <Caption>{`Bar weight (${unit})`}</Caption>
              <Input accessibilityLabel={`Bar weight in ${unit}`} inputMode="decimal" value={barText} onChangeText={saveBar} invalid={barBad} />
              {barBad ? <ErrorText>{`Type one number from 0 to ${BAR_MAX}, like ${DEFAULT_BAR[unit]}.`}</ErrorText> : null}
              <Caption>Plates your gym has (each side)</Caption>
              <View style={styles.chips}>
                {all.map((p) => (
                  <Chip key={p} label={`Plate ${p} ${unit}`} text={String(p)} pressed={mine.plates.includes(p)} onPress={() => togglePlate(p)} />
                ))}
              </View>
              <Hint>Kept on this device.</Hint>
            </View>
          </Disclosure>
        </View>
      </ScrollView>
    </SheetModal>
  );
}

/** The quiet "Plates" link under a set row (or on the Library detail) and the sheet it opens. */
export function PlatesLink({ name, label, targetKg, onApply }: { name: string; label: string; targetKg: number | null; onApply?: (kg: number) => void }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Press accessibilityRole="button" accessibilityLabel={label} {...a11yState({ expanded: open })} onPress={() => setOpen(true)} style={styles.link}>
        <Text style={[type.textBody, { color: c.link, textDecorationLine: 'underline' }]}>Plates</Text>
      </Press>
      {open ? <PlateSheet name={name} targetKg={targetKg} onApply={onApply} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  near: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  stack: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 90, flexWrap: 'nowrap', overflow: 'hidden' },
  bar: { width: 28, height: 10, borderRadius: 3 },
  block: { width: 28, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  blockText: { color: '#111111', fontSize: 11, fontWeight: '700' },
});
