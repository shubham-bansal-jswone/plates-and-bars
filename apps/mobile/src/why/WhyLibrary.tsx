import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Heading, Hint } from '../components/ui';
import { Text } from '../components/Text';
import { useOptionalSettings } from '../state/SettingsProvider';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { cardOffered, chosenCards, whyCard, type WhyValues } from './cards';
import { readLearn } from './learn';
import { WhySheet } from './WhyLink';

/** Prototype `libraryHtml`: every card that is not held back or ruled out for this profile (no split card with 0 training days), with its evidence and a "read" mark once opened. */
export function WhyLibrary({ values, now }: { values?: WhyValues; now?: () => Date }) {
  const c = useTheme();
  const settings = useOptionalSettings();
  const [open, setOpen] = useState<string | null>(null);
  const read = readLearn(settings?.settings.learn ?? {}).read;
  const cards = chosenCards().cards.filter((x) => whyCard(x.id) !== null && cardOffered(x.id, values));
  return (
    <View style={styles.box}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Why it works</Heading>
      <Hint>Short explanations behind the app’s suggestions, with the evidence for each.</Hint>
      {cards.map((x) => (
        <View key={x.id} style={styles.row}>
          <Text style={[styles.title, { color: c.ink }]}>
            {`${x.title} ${x.evidence}`}
            {read.includes(x.id) ? <Text style={{ color: c.muted }}>{' read'}</Text> : null}
          </Text>
          <Button kind="ghost" label="Open" a11yLabel={`Open ${x.title}`} onPress={() => setOpen(x.id)} />
        </View>
      ))}
      {open ? <WhySheet id={open} values={values} now={now} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1 },
});
