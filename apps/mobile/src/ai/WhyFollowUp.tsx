import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, ErrorText, Field, Hint, Note } from '../components/ui';
import { isBlank } from '../text/blank';
import { useAi } from './AiProvider';
import { AI_COPY, failureMessage } from './copy';
import { cardTitle } from './cards';

const QUESTION_MAX = 300;

/**
 * "Ask a follow-up" under a Why card (prototype `openWhy`). Renders nothing unless AI is on for this user and the server
 * has Ask why on, so the card reads the same as before. Only the card id and the typed question are sent; the answer
 * is held here and dropped when the sheet closes.
 */
export function WhyFollowUp({ cardId }: { cardId: string }) {
  // The form is its own component so that hiding it (switched off, consent withdrawn) drops what was typed and any old message.
  return useAi().available('ask_why') ? <FollowUpForm cardId={cardId} /> : null;
}

function FollowUpForm({ cardId }: { cardId: string }) {
  const ai = useAi();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; card: string | null } | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => void (alive.current = false), []);

  const used = ai.quotaUsed();

  const send = async () => {
    if (inFlight.current || ai.quotaUsed() || isBlank(question)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setAnswer(null);
    const r = await ai.askWhy(cardId, question);
    inFlight.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(failureMessage(r, AI_COPY.askFallback));
    setAnswer({ text: r.data.answer, card: r.data.card_id });
  };

  return (
    <View style={styles.body}>
      <Field label="Ask a follow-up" placeholder="e.g. Is 150 g too much protein?" multiline maxLength={QUESTION_MAX} value={question} onChangeText={setQuestion} />
      {used ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.askFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
      {used ? null : <Button kind="ghost" label={busy ? 'Thinking…' : 'Ask'} a11yLabel="Ask" busy={busy} onPress={() => void send()} />}
      {answer ? (
        <View accessibilityLiveRegion="polite" style={styles.body}>
          <Note>{answer.text}</Note>
          {answer.card ? <Hint>{`Based on the card: ${cardTitle(answer.card)}`}</Hint> : null}
          <Hint>{AI_COPY.aiNote}</Hint>
        </View>
      ) : null}
      <Hint>Answers come only from the app’s cards. If they don’t cover it, the answer will say so.</Hint>
    </View>
  );
}

const styles = StyleSheet.create({ body: { width: '100%', gap: 10 } });
