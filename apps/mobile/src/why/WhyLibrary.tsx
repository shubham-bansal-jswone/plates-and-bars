import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Heading, Hint, Press } from '../components/ui';
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
        <Press key={x.id} accessibilityRole="button" accessibilityLabel={`Open ${x.title}`} onPress={() => setOpen(x.id)} style={[styles.row, { borderColor: c.line }]}>
          <View style={styles.title}>
            <Text style={{ color: c.ink }}>
              {x.title}
              {read.includes(x.id) ? <Text style={{ color: c.muted }}>{' read'}</Text> : null}
            </Text>
            <Text style={[typeScale.small, { color: c.muted }]}>{`${x.evidence} evidence`}</Text>
          </View>
          <Svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
            <Path d="M7 4l6 6-6 6" stroke={c.muted} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Press>
      ))}
      {open ? <WhySheet id={open} values={values} now={now} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 56, paddingVertical: 6, borderTopWidth: 1 },
  title: { flex: 1 },
});
