import { StyleSheet, View } from 'react-native';
import { CARDIO_WEEK_MIN, round1 } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, Hint } from '../components/ui';
import { fmt, shortDate } from '../format';
import { useProfile } from '../state/ProfileProvider';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BURN_HOW, BURN_TITLE, CHECKIN_NEEDS_SETUP, CHECKIN_TITLE, HABIT_MESSAGE, KEEP_TARGETS, NOT_NOW, STOP_SUGGESTING, WEIGHT_WEEK_NONE } from './copy';
import type { useCheckin } from './useCheckin';

type Checkin = ReturnType<typeof useCheckin>;
const L = (n: number): string => round1(n).toLocaleString('en-IN');

function Stat({ big, small, label }: { big: string; small?: string; label: string }) {
  const c = useTheme();
  return (
    <Card style={styles.stat} accessible accessibilityLabel={`${big}${small ?? ''} ${label}`}>
      <Text style={[typeScale.title, { color: c.ink }]}>{big}{small ? <Text style={{ color: c.muted, fontSize: 13 }}>{small}</Text> : null}</Text>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
    </Card>
  );
}

/** Progress tab: weekly check-in with its one suggestion, the real-burn card and gentle habits (no AI summary). */
export function CheckinCard({ date, c: ci }: { date: string; c: Checkin }) {
  const t = useTheme();
  const { profile } = useProfile();
  const k = ci.checkin;
  const h = ci.habit;
  if (!profile) return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: t.ink }]}>{CHECKIN_TITLE}</Text>
      <Hint>{CHECKIN_NEEDS_SETUP}</Hint>
    </View>
  );
  if (!k || !h) return null;
  const target = profile.targets.kcal;
  // TODO(#264): the week-on-week weight change.
  const weekly = k.w1 !== null && k.w0 !== null ? `Weight: weekly average ${L(k.w1)} kg, ${k.w1 <= k.w0 ? 'down' : 'up'} ${L(Math.abs(k.w1 - k.w0))} kg from last week.` : WEIGHT_WEEK_NONE;
  // TODO(#264): sleep < 7 (below) and slope x 7 (burn card) come from core's weeklyCheckin once it returns them.
  const cardio = `Cardio: ${fmt(k.cardioMin)} of ${CARDIO_WEEK_MIN} min this week (brisk walking counts).${k.steps !== null ? ` Steps: about ${fmt(k.steps)} a day.` : ''}${k.sleep !== null ? ` Sleep: ${round1(k.sleep)} hours a night${k.sleep < 7 ? ', under the 7–9 hours that best supports fat loss and recovery' : ''}.` : ''}`;
  const lifts = `${k.improved.length ? `Stronger on ${k.improved.map((x) => `${x.n} (+${x.pct}%)`).join(', ')}.` : 'No lift beat its previous best this week.'}${k.stalled.length ? ` Stalled: ${k.stalled.join(', ')}.` : ''}`;
  const b = k.burn;
  const s = k.suggestion;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: t.ink }]}>{CHECKIN_TITLE}</Text>
      <Hint>{`The 7 days up to ${shortDate(date)}`}</Hint>
      <View style={styles.grid}>
        <Stat big={String(k.sessions)} small={` / ${k.plannedN}`} label="sessions" />
        <Stat big={String(k.logged)} small=" / 7" label="days logged" />
        <Stat big={k.logged ? fmt(k.avgK) : '–'} label={`avg kcal${k.logged ? ` (target ${fmt(target)})` : ''}`} />
        <Stat big={k.logged ? `${fmt(k.avgP)} g` : '–'} label={`avg protein, ${k.pDays} day${k.pDays === 1 ? '' : 's'} on target`} />
      </View>
      <Text style={{ color: t.ink }}>{weekly}</Text>
      <Text style={{ color: t.ink }}>{cardio}</Text>
      <Text style={{ color: t.ink }}>{lifts}</Text>
      <Card style={styles.gap}>
        <Text style={{ color: t.ink, fontWeight: '700' }}>{BURN_TITLE}</Text>
        {b.ready ? (
          <Text style={{ color: t.ink }}>{`About ${fmt(b.burn)} kcal a day${k.formula !== null ? `, compared with ${fmt(k.formula)} from the setup formula` : ''}. Based on ${b.logged} complete days and your weight trend (${b.slope <= 0 ? 'down' : 'up'} ${L(Math.abs(b.slope * 7))} kg a week).`}</Text>
        ) : (
          <Hint>{`Needs ${[b.needDays ? `${b.needDays} more complete day${b.needDays === 1 ? '' : 's'} in the last 2 weeks (tick “I’ve logged everything” on the Food tab)` : '', b.needW ? `${b.needW} more weigh-in${b.needW === 1 ? '' : 's'} in the last 3 weeks` : ''].filter(Boolean).join(' and ')}. Until then, the setup formula is used.`}</Hint>
        )}
        <Hint>{BURN_HOW}</Hint>
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
              <Button label="Use a 4-day plan next week" onPress={ci.shorterWeek} />
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
      <View style={styles.grid}>
        <Stat big={String(h.thisWeek)} label={`sessions this week (aim ${h.goal}+)`} />
        <Stat big={`${h.logged}/7`} label="days with food logged" />
        <Stat big={String(h.weeks)} label="on-track weeks in a row" />
      </View>
      <Hint>{h.message === 'streak' ? HABIT_MESSAGE.streak(h.weeks, h.goal) : HABIT_MESSAGE[h.message]}</Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  gap: { gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: '45%', gap: 2 },
});
