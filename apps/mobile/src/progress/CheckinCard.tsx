import { StyleSheet, View } from 'react-native';
import { WhyLink } from '../why/WhyLink';
import { CYCLE_CHECKIN_NOTE } from '../cycle/copy';
import { CARDIO_WEEK_MIN, RAPID_LOSS_KCAL, round1 } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Heading, Button, Card, Disclosure, Hint, MetricRow } from '../components/ui';
import { fmt, shortDate } from '../format';
import { useProfile } from '../state/ProfileProvider';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BURN_HOW, BURN_TITLE, CHECKIN_NEEDS_SETUP, CHECKIN_TITLE, HABIT_MESSAGE, KEEP_TARGETS, NOT_NOW, RAPID_BODY, RAPID_TITLE, SETTINGS_UNREADABLE, STOP_SUGGESTING, WEIGHT_WEEK_NONE } from './copy';
import type { useCheckin } from './useCheckin';

type Checkin = ReturnType<typeof useCheckin>;
const L = (n: number): string => round1(n).toLocaleString('en-IN');

/** "Weight is dropping fast": offers adding 150 kcal to the targets. Nothing shows when muted, dismissed, or settings are unreadable. */
export function RapidLossCard({ c: ci }: { c: Checkin }) {
  const t = useTheme();
  const r = ci.rapid;
  if (!r || ci.settingsFailed) return null;
  return (
    <Card style={styles.gap}>
      <Text style={{ color: t.ink, fontWeight: '700' }}>{RAPID_TITLE}</Text>
      <Text style={{ color: t.ink }}>{RAPID_BODY(round1(r.drop), r.twoWeeks, r.stalls)}</Text>
      <Button label={`Add ${RAPID_LOSS_KCAL} kcal`} onPress={() => void ci.addCalories()} />
      <Button label={NOT_NOW} kind="ghost" onPress={ci.declineRapid} />
      {ci.rapidDeclines >= 3 ? <Button label={STOP_SUGGESTING} kind="ghost" onPress={ci.stopSuggestingRapid} /> : null}
    </Card>
  );
}

/** Progress tab: weekly check-in with its one suggestion, the real-burn card and gentle habits (no AI summary). */
/** `cycleNote`: the viewed day is in the period or luteal phase of a cycle log kept on this device, so the weight line adds the water-retention sentence. */
export function CheckinCard({ date, c: ci, cycleNote = false }: { date: string; c: Checkin; cycleNote?: boolean }) {
  const t = useTheme();
  const { profile } = useProfile();
  const k = ci.checkin;
  const h = ci.habit;
  if (!profile) return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: t.ink }]}>{CHECKIN_TITLE}</Heading>
      <Hint>{CHECKIN_NEEDS_SETUP}</Hint>
    </View>
  );
  if (ci.settingsFailed) return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: t.ink }]}>{CHECKIN_TITLE}</Heading>
      <Hint>{SETTINGS_UNREADABLE}</Hint>
    </View>
  );
  if (!k || !h) return null;
  const target = profile.targets.kcal;
  const ch = k.weeklyChange;
  const weekly = ch ? `Weight: weekly average ${L(k.w1 ?? 0)} kg, ${ch.down ? 'down' : 'up'} ${L(ch.amount)} kg from last week.` : WEIGHT_WEEK_NONE;
  const slope = k.slopePerWeek ?? 0;
  const cardio = `Cardio: ${fmt(k.cardioMin)} of ${CARDIO_WEEK_MIN} min this week (brisk walking counts).${k.steps !== null ? ` Steps: about ${fmt(k.steps)} a day.` : ''}${k.sleep !== null ? ` Sleep: ${round1(k.sleep)} hours a night${k.sleepShort ? ', under the 7–9 hours that best supports fat loss and recovery' : ''}.` : ''}`;
  const lifts = `${k.improved.length ? `Stronger on ${k.improved.map((x) => `${x.n} (+${x.pct}%)`).join(', ')}.` : 'No lift beat its previous best this week.'}${k.stalled.length ? ` Stalled: ${k.stalled.join(', ')}.` : ''}`;
  const b = k.burn;
  const s = k.suggestion;
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: t.ink }]}>{CHECKIN_TITLE}</Heading>
      <Hint>{`The 7 days up to ${shortDate(date)}`}</Hint>
      {/* The one lime number on the Progress screen: sessions done this week. */}
      <Card>
        <MetricRow cells={[
          { value: String(k.sessions), small: ` / ${k.plannedN}`, label: 'sessions', lime: true },
          { value: String(k.logged), small: ' / 7', label: 'days logged' },
        ]} />
      </Card>
      <Card>
        <MetricRow cells={[
          { value: k.logged ? fmt(k.avgK) : '–', label: `avg kcal${k.logged ? ` (target ${fmt(target)})` : ''}` },
          { value: k.logged ? `${fmt(k.avgP)} g` : '–', label: `avg protein, ${k.pDays} day${k.pDays === 1 ? '' : 's'} on target` },
        ]} />
      </Card>
      <Text style={{ color: t.ink }}>{cycleNote ? `${weekly} ${CYCLE_CHECKIN_NOTE}` : weekly}</Text>
      <Text style={{ color: t.ink }}>{cardio}</Text>
      <WhyLink id="activity" />
      <Text style={{ color: t.ink }}>{lifts}</Text>
      <Card style={styles.gap}>
        <Text style={{ color: t.ink, fontWeight: '700' }}>{BURN_TITLE}</Text>
        {b.ready ? (
          <Text style={{ color: t.ink }}>{`About ${fmt(b.burn)} kcal a day${k.formula !== null ? `, compared with ${fmt(k.formula)} from the setup formula` : ''}. Based on ${b.logged} complete days and your weight trend (${slope <= 0 ? 'down' : 'up'} ${L(Math.abs(slope))} kg a week).`}</Text>
        ) : (
          <Hint>{`Needs ${[b.needDays ? `${b.needDays} more complete day${b.needDays === 1 ? '' : 's'} in the last 2 weeks (tick “I’ve logged everything” on the Food tab)` : '', b.needW ? `${b.needW} more weigh-in${b.needW === 1 ? '' : 's'} in the last 3 weeks` : ''].filter(Boolean).join(' and ')}. Until then, the setup formula is used.`}</Hint>
        )}
        <Disclosure label="How this works"><Hint>{BURN_HOW}</Hint></Disclosure>
      </Card>
      {s ? (
        <Card style={styles.gap}>
          {s.kind === 'kcal' ? (
            <>
              <Text style={{ color: t.ink, fontWeight: '700' }}>{`Adjust calories to ${fmt(s.target.kcal)}?`}</Text>
              <Text style={{ color: t.ink }}>{`Your real data puts your burn at about ${b.ready ? fmt(b.burn) : ''} kcal a day. To stay on track for your goal, a target of ${fmt(s.target.kcal)} kcal fits better than ${fmt(target)}. Protein stays at ${s.target.protein} g.`}</Text>
              <Button label="Update my targets" onPress={() => void ci.applyTargets()} />
              <Button label={KEEP_TARGETS} kind="ghost" onPress={ci.decline} />
            </>
          ) : s.kind === 'week' ? (
            <>
              <Text style={{ color: t.ink, fontWeight: '700' }}>A shorter week might fit better</Text>
              <Text style={{ color: t.ink }}>{`You trained ${k.sessions} of ${k.plannedN} days. A 4-day plan next week keeps every muscle covered with fewer sessions.`}</Text>
              <Button label="Use a 4-day plan next week" kind="ghost" onPress={ci.shorterWeek} />
              <Button label={NOT_NOW} kind="ghost" onPress={ci.decline} />
            </>
          ) : (
            <>
              <Text style={{ color: t.ink, fontWeight: '700' }}>Protein was the gap this week</Text>
              <Text style={{ color: t.ink }}>{`You averaged ${fmt(k.avgP)} g against ${profile.targets.protein_g} g. The meal ideas on the Food tab now put protein first; a whey scoop or a katori of Greek yogurt as a snack closes most of the gap.`}</Text>
            </>
          )}
          {s.kind !== 'protein' && ci.declines >= 3 ? <Button label={STOP_SUGGESTING} kind="ghost" onPress={ci.stopSuggesting} /> : null}
        </Card>
      ) : null}
      <Card>
        <MetricRow cells={[
          { value: String(h.thisWeek), label: `sessions this week (aim ${h.goal}+)` },
          { value: `${h.logged}/7`, label: 'days with food logged' },
          { value: String(h.weeks), label: 'on-track weeks in a row' },
        ]} />
      </Card>
      <Hint>{h.message === 'streak' ? HABIT_MESSAGE.streak(h.weeks, h.goal) : HABIT_MESSAGE[h.message]}</Hint>
      <WhyLink id="habits" />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  gap: { gap: 8 },
});
