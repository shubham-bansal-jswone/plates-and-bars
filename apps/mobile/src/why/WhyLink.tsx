import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Heading, Hint } from '../components/ui';
import { Text } from '../components/Text';
import { useTheme } from '../theme/useTheme';
import { renderBody, whyCard, type WhyValues } from './cards';

const EVIDENCE_NOTE = { Strong: 'Many studies agree.', Moderate: 'Good support, some open questions.', Emerging: 'Early or limited research.' } as const;

/** The card as a sheet: summary, body, how strong the evidence is, and the source. Works offline (the cards are on the device). */
export function WhySheet({ id, values, onClose }: { id: string; values?: WhyValues; onClose: () => void }) {
  const c = useTheme();
  const card = whyCard(id);
  if (!card) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.body}>
          <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{card.title}</Heading>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{card.summary}</Text>
          <Text style={{ color: c.ink, lineHeight: 22 }}>{renderBody(card.body, values)}</Text>
          <Hint>{`Evidence: ${card.evidence}. ${EVIDENCE_NOTE[card.evidence]}`}</Hint>
          <Hint>{`Source: ${card.source}.${card.review_status === 'draft' ? ' Draft card, not yet reviewed by a coach or dietitian.' : ''} Not medical advice.`}</Hint>
          <Button kind="ghost" label="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

/** Prototype `whyLink(id, label)`: a "Why?" button that opens the card. Renders nothing for an unknown or held-back card. */
export function WhyLink({ id, label = 'Why?', values }: { id: string; label?: string; values?: WhyValues }) {
  const [open, setOpen] = useState(false);
  const card = whyCard(id);
  if (!card) return null;
  return (
    <>
      <Button kind="link" label={label} a11yLabel={`${label} ${card.title}`} onPress={() => setOpen(true)} />
      {open ? <WhySheet id={id} values={values} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 10 },
});
