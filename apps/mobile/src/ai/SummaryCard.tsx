import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WeeklyCheckin } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, ErrorText, Hint, Note } from '../components/ui';
import type { Profile } from '../setup/types';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { useAi } from './AiProvider';
import { AI_COPY, failureMessage } from './copy';
import { buildSummaryRequest } from './summaryRequest';

/** Weekly summary (AI) on Progress: shown only when on and opted in, written on tap, kept in this card's state only. */
export function SummaryCard({ checkin, profile }: { checkin: WeeklyCheckin | null; profile: Profile | null }) {
  const c = useTheme();
  const ai = useAi();
  const [written, setWritten] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => void (alive.current = false), []);
  // A different week's facts make the old text stale.
  const text = written && written.key === checkin?.key ? written.text : null;

  if (!ai.available('weekly_summary') || !checkin || !profile) return null;
  const body = buildSummaryRequest(checkin, profile.targets, profile.goal);
  const send = async () => {
    if (inFlight.current || ai.quotaUsed() || !body) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await ai.weeklySummary(body);
    inFlight.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(failureMessage(r, AI_COPY.summaryFallback, AI_COPY.summaryInvalid));
    setWritten({ key: checkin.key, text: r.data.text });
  };
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: c.ink }]}>{AI_COPY.summaryTitle}</Text>
      {text ? (
        <View accessibilityLiveRegion="polite" style={styles.live}>
          <Note>{text}</Note>
          <Hint>{AI_COPY.aiNote}</Hint>
        </View>
      ) : (
        <Hint>{body ? AI_COPY.summaryHint : AI_COPY.summaryNeedsPlan}</Hint>
      )}
      {ai.quotaUsed() ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.summaryFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
      {body && !ai.quotaUsed() ? <Button kind="ghost" label={busy ? 'Writing…' : text ? 'Write it again' : AI_COPY.summaryButton} a11yLabel={text ? 'Write it again' : AI_COPY.summaryButton} busy={busy} onPress={() => void send()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: 8, marginTop: 16 }, live: { gap: 8 } });
