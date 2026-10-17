import { StyleSheet, View } from 'react-native';
import { WhyLink } from '../why/WhyLink';
import { repWord, type ExInfo, type LadderCard, type RecoveryCard, type ReentryCard, type StallCard, type SteadyCard } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Heading, Button, Card } from '../components/ui';
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
function AdjCard({ title, level = 3, subject, children, buttons, declines = 0, onMute, why }: { title: string; /** A Why it works card id, linked under the text. */ why?: string; /** 2 when the card is not inside an exercise card. */ level?: 2 | 3; subject: string; children: string; buttons: Btn[]; declines?: number; onMute?: () => void }) {
  const c = useTheme();
  return (
    <Card style={{ backgroundColor: c.tint, gap: 6 }}>
      <Heading level={level} style={{ color: c.ink, fontWeight: '700' }}>{title}</Heading>
      <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{children}</Text>
      {why ? <WhyLink id={why} subject={subject} /> : null}
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
      why="stall"
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

/** The "Several lifts have stalled" card (prototype `renderStart`, recovery-week step). */
export function RecoveryCardView({ card, onStart, ...c }: { card: RecoveryCard; onStart: () => void } & Common) {
  const named = `${card.names.join(', ')}${card.more > 0 ? ` and ${card.more} more` : ''}`;
  return (
    <AdjCard
      title="Several lifts have stalled"
      why="deload"
      level={2}
      subject="recovery week"
      declines={c.declines}
      onMute={c.onMute}
      buttons={[{ label: 'Start recovery week', primary: true, onPress: onStart }, { label: 'Not now', onPress: c.onNo }]}
    >
      {`${named} haven’t moved in 3 sessions. A recovery week usually fixes this: same exercises, fewer sets and about 10% lighter for 7 days.`}
    </AdjCard>
  );
}

/** The "Welcome back" card after a break (prototype `renderStart`, "back after a break" step). */
export function ReentryCardView({ card, onEase, ...c }: { card: ReentryCard; onEase: () => void } & Common) {
  return (
    <AdjCard
      title={`Welcome back. It’s been ${card.gap} days.`}
      level={2}
      subject="re-entry"
      declines={c.declines}
      onMute={c.onMute}
      buttons={[{ label: 'Ease back in', primary: true, onPress: onEase }, { label: 'Train as normal', onPress: c.onNo }]}
    >
      {card.long
        ? 'For the next 2 weeks: about 30% lighter and 1 fewer set per exercise, building back to normal. Your strength returns faster than it took to build.'
        : 'For this week: start about 15% lighter and build back up over a few sessions.'}
    </AdjCard>
  );
}

/** "You missed X on Monday": shift the week forward (prototype `renderStart`, missed-day step). */
export function MissedCardView({ missed, weekday, stick, onShift, ...c }: { missed: { t: string }; weekday: string; /** The planned day the "Stick to" button names. */ stick: string; onShift: () => void } & Common) {
  return (
    <AdjCard
      title={`You missed ${missed.t} on ${weekday}`}
      level={2}
      subject="missed day"
      declines={c.declines}
      onMute={c.onMute}
      buttons={[{ label: 'Shift the week', primary: true, onPress: onShift }, { label: `Stick to ${stick}`, onPress: c.onNo }]}
    >
      {`Shift the week forward so nothing gets skipped? Today becomes ${missed.t}, and the rest of the plan follows in order.`}
    </AdjCard>
  );
}

/** The "N steady weeks of training" card: an optional lighter week (prototype `renderStart`). */
export function SteadyCardView({ card, onStart, ...c }: { card: SteadyCard; onStart: () => void } & Common) {
  return (
    <AdjCard
      title={`${card.weeks} steady weeks of training`}
      why="deload"
      level={2}
      subject="lighter week"
      declines={c.declines}
      onMute={c.onMute}
      buttons={[{ label: 'Take a lighter week', primary: true, onPress: onStart }, { label: 'Keep going', onPress: c.onNo }]}
    >
      {'Many programmes take a lighter week every 6–8 weeks to let fatigue clear. The research on timing is limited, so this is optional: fewer sets and about 10% lighter for 7 days.'}
    </AdjCard>
  );
}

/** The note while a recovery week or re-entry period runs, with its way out (prototype `renderStart`). */
export function RangeNote({ text, action, onEnd }: { text: string; action: string; onEnd: () => void }) {
  const c = useTheme();
  return (
    <View style={styles.row}>
      <Text style={{ color: c.muted, fontSize: 14 }}>{text}</Text>
      <Button label={action} kind="link" onPress={onEnd} />
    </View>
  );
}

/** "Ready to try X again?" for a timed rule that ended (prototype `recheckCards`). */
export function RecheckCard({ rule, onBack, onLater, onKeep }: { rule: ExclusionRecord; onBack: () => void; onLater: () => void; onKeep: () => void }) {
  const what = rule.scope === 'exercise' ? rule.key : ruleText(rule).split(',')[0];
  return (
    <AdjCard
      title={`Ready to try ${what} again?`}
      level={2}
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
