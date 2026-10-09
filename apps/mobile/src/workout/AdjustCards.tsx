import { StyleSheet, View } from 'react-native';
import { repWord, type ExInfo, type LadderCard, type StallCard } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card } from '../components/ui';
import type { ExclusionRecord } from '../db/rules';
import { useTheme } from '../theme/useTheme';
import { ruleText } from './rulesCopy';

interface Btn {
  label: string;
  primary?: boolean;
  onPress: () => void;
}

/** A card with a bold title, a line of text and answer buttons (prototype `.adj`). After 3 declines it offers to stop. */
/** `subject` is the exercise the card is about: buttons repeat per exercise, so each is spoken with it. */
function AdjCard({ title, subject, children, buttons, declines = 0, onMute }: { title: string; subject: string; children: string; buttons: Btn[]; declines?: number; onMute?: () => void }) {
  const c = useTheme();
  return (
    <Card style={{ backgroundColor: c.tint, gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{children}</Text>
      <View style={styles.row}>
        {buttons.map((b) => (
          <Button key={b.label} label={b.label} a11yLabel={`${b.label}, ${subject}`} kind={b.primary ? 'primary' : 'ghost'} onPress={b.onPress} />
        ))}
        {declines >= 3 && onMute ? <Button label="Stop suggesting this" a11yLabel={`Stop suggesting this, ${subject}`} kind="link" onPress={onMute} /> : null}
      </View>
    </Card>
  );
}

interface Common {
  declines: number;
  onMute: () => void;
  /** "Not now" / "Not yet". */
  onNo: () => void;
}

/** The "No progress in 3 sessions" card (prototype `stallCard`); `side` is `sidewaysOf`'s exercise, if any. */
export function StallCardView({ name, card, info, side, onRange, onSide, ...c }: { name: string; card: StallCard; info: ExInfo; side: string | null; onRange: () => void; onSide: () => void } & Common) {
  const [lo, hi] = card.range;
  return (
    <AdjCard
      title="No progress in 3 sessions"
      subject={name}
      declines={c.declines}
      onMute={c.onMute}
      buttons={[
        { label: `Switch to ${lo}–${hi}`, primary: true, onPress: onRange },
        ...(side ? [{ label: `Or switch to ${side}`, onPress: onSide }] : []),
        { label: 'Not now', onPress: c.onNo },
      ]}
    >
      {`Try a ${card.heavy ? 'heavier' : 'lighter'} rep range for the next few weeks: ${lo}–${hi} ${repWord(info.type)}. It’s also worth checking sleep and protein.`}
    </AdjCard>
  );
}

/** The ladder step-up and step-down cards (prototype `ladderCard`). */
export function LadderCardView({ card, name, onSwitch, onStay, ...c }: { card: LadderCard; name: string; onSwitch: () => void; onStay: () => void } & Common) {
  if (card.kind === 'down')
    return (
      <AdjCard
        title={`Step down to ${card.to} for a few weeks?`}
        subject={name}
        declines={c.declines}
        onMute={c.onMute}
        buttons={[{ label: `Switch to ${card.to}`, primary: true, onPress: onSwitch }, { label: 'Not now', onPress: c.onNo }]}
      >
        {`The last two sessions had ${card.because === 'form' ? 'form breaking down' : 'failed sets'}. A slightly easier version builds the base, and the app will suggest moving back up when you’re ready.`}
      </AdjCard>
    );
  return (
    <AdjCard
      title={`Ready to try ${card.to}?`}
      subject={name}
      declines={c.declines}
      onMute={c.onMute}
      buttons={[{ label: 'Try it next session', primary: true, onPress: onSwitch }, { label: 'Not yet', onPress: c.onNo }, { label: 'Stay on this step', onPress: onStay }]}
    >
      {`You’ve reached the top of the rep range with solid form, and you’ve done ${name} for ${card.sessions} sessions (a rule of thumb). For the first 2 weeks, ${card.to} goes first and a lighter ${name} follows.`}
    </AdjCard>
  );
}

/** "Ready to try X again?" for a timed rule that ended (prototype `recheckCards`). */
export function RecheckCard({ rule, onBack, onLater, onKeep }: { rule: ExclusionRecord; onBack: () => void; onLater: () => void; onKeep: () => void }) {
  const what = rule.scope === 'exercise' ? rule.key : ruleText(rule).split(',')[0];
  return (
    <AdjCard
      title={`Ready to try ${what} again?`}
      subject={what ?? rule.key}
      buttons={[
        { label: 'Try it again', primary: true, onPress: onBack },
        { label: '2 more weeks', onPress: onLater },
        { label: 'Keep it out', onPress: onKeep },
      ]}
    >
      {`${rule.reason === 'pain' ? 'Only if it’s been pain-free. After an injury, get your physio’s go-ahead first. ' : ''}You’ll start at about 55% of your old weight for 2 weeks${rule.reason === 'pain' ? '.' : ', then build back up.'}`}
    </AdjCard>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' } });
