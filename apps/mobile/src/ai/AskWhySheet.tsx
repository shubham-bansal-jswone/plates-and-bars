import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, ErrorText, Field, Hint, Note, Press } from '../components/ui';
import { radius, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { useAi } from './AiProvider';
import { AI_COPY, failureMessage } from './copy';
import { ASK_CARDS, cardTitle } from './cards';

const QUESTION_MAX = 300;

/**
 * Ask why (AI) about one of the target cards. Only the card id and the typed question are sent; the answer is shown here
 * and dropped on close.
 */
export function AskWhySheet({ onClose }: { onClose: () => void }) {
  const c = useTheme();
  const ai = useAi();
  const [card, setCard] = useState<string>(ASK_CARDS[0]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; card: string | null } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const send = async () => {
    if (busy || !question.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    const r = await ai.askWhy(card, question);
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(failureMessage(r, AI_COPY.askFallback));
    setAnswer({ text: r.data.answer, card: r.data.card_id });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{AI_COPY.askTitle}</Text>
          <Hint>{AI_COPY.askHint}</Hint>
          <View accessibilityRole="tablist" style={styles.row}>
            {ASK_CARDS.map((id) => (
              <Press key={id} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="tab" accessibilityLabel={cardTitle(id)} accessibilityState={{ selected: card === id }} onPress={() => setCard(id)} style={[styles.tab, { backgroundColor: card === id ? c.brand : c.surfaceSoft }]}>
                <Text style={{ color: card === id ? c.onBrand : c.ink, ...type.buttonSm }}>{cardTitle(id)}</Text>
              </Press>
            ))}
          </View>
          <Field label="Your question" placeholder="Is 150 g of protein too much for me?" multiline maxLength={QUESTION_MAX} value={question} onChangeText={setQuestion} />
          {ai.quotaUsed() ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.askFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
          <Button label={busy ? 'Asking…' : 'Ask'} onPress={() => void send()} />
          {answer ? (
            <View style={styles.body}>
              <Note>{answer.text}</Note>
              {answer.card ? <Hint>{`Based on the card: ${cardTitle(answer.card)}`}</Hint> : null}
              <Hint>{AI_COPY.aiNote}</Hint>
            </View>
          ) : null}
          <Button kind="ghost" label="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  tab: { borderRadius: radius.full, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
});
