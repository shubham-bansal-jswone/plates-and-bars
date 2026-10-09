import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Hint, Label, Press, Switch } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { AskWhySheet } from './AskWhySheet';
import { useAi } from './AiProvider';
import { AI_COPY } from './copy';
import type { AiFeature } from './client';

const FEATURES: AiFeature[] = ['describe_meal', 'ask_why', 'weekly_summary'];

/** Targets tab: the AI consent toggle (off by default, says what is sent) and, once on and available, Ask why. Hidden when signed out or the build has no server. */
export function AiSection() {
  const c = useTheme();
  const ai = useAi();
  const [asking, setAsking] = useState(false);
  if (!ai.canConsent) return null;
  const on = FEATURES.filter((f) => ai.available(f));
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Label>{AI_COPY.consentTitle}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Switch accessibilityLabel={AI_COPY.consentLabel} value={ai.consent} onValueChange={(v) => void ai.setConsent(v)} />
        <Press focusable={false} accessibilityElementsHidden importantForAccessibility="no" onPress={() => void ai.setConsent(!ai.consent)} style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 16 }}>{AI_COPY.consentLabel}</Text>
        </Press>
      </View>
      <Hint>{AI_COPY.consentOff}</Hint>
      <Hint>{AI_COPY.consentSent}</Hint>
      {ai.consent ? <Hint>{on.length ? AI_COPY.consentOn(on.map((f) => AI_COPY.names[f])) : AI_COPY.consentNone}</Hint> : null}
      {ai.consent && ai.quota && on.length ? <Hint>{AI_COPY.consentLeft(ai.quota)}</Hint> : null}
      {ai.available('ask_why') ? <Button kind="ghost" label={AI_COPY.askButton} a11yLabel="Ask why about your targets" onPress={() => setAsking(true)} /> : null}
      {asking ? <AskWhySheet onClose={() => setAsking(false)} /> : null}
    </View>
  );
}
