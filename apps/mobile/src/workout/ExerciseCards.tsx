import { inRange, ladderCard, missed as missedDay, recoveryCard, reentryCard, ladderStayUntil, ladderSwap, recheckBack, recheckDue, recheckKeep, recheckLater, sidewaysOf, stallCard, stallRangeOverride, steadyCard, type ExInfo, type LiftRecord, type PlanProfile, type SessionLog, type Where, type WeekPlan } from '@plate-and-bar/core';
import type { ExclusionRecord } from '../db/rules';
import { useSettings } from '../state/SettingsProvider';
import { SETTINGS_UNREADABLE } from '../progress/copy';
import { ownGet, withEntry } from '../content/own';
import { shortDate, weekdayLong } from '../format';
import { adjOf, answered, endAdj, muted, rangesOf, shiftWeek, startDeload, startReentry } from './adjust';
import { getCatalog } from './catalog';
import { LadderCardView, MissedCardView, RangeNote, RecheckCard, RecoveryCardView, ReentryCardView, StallCardView, SteadyCardView } from './AdjustCards';
import type { ExState } from './model';
import type { useRules } from './useRules';

type Rules = ReturnType<typeof useRules>;

const NOT_SAVED = SETTINGS_UNREADABLE;

/** The settings writer, refusing (with a message) when the stored settings could not be read, so nothing looks saved that is not. */
function guarded(write: ReturnType<typeof useSettings>['update'], loadFailed: boolean, notify: (msg: string) => void): (p: Parameters<typeof write>[0]) => boolean {
  return (p) => {
    if (loadFailed || !write(p)) {
      notify(NOT_SAVED);
      return false;
    }
    return true;
  };
}

const MUTED = 'Got it, no more of these';

interface Props {
  date: string;
  lifts: Readonly<Record<string, LiftRecord>>;
  rules: Rules;
  notify: (msg: string) => void;
}

/** The stall card, or else the ladder card, under an exercise's suggestion (prototype `stallCard` then `ladderCard`). */
export function ExerciseCards({ ex, info, date, lifts, rules, notify, where }: Props & { ex: ExState; info: ExInfo; /** Where today's session happens (the day's `where`, else the profile's). */ where: Where }) {
  const { settings, update: write, loadFailed } = useSettings();
  const update = guarded(write, loadFailed, notify);
  const adj = adjOf(settings.adjustments);
  const exclusions = rules.rules.exclusions;
  const dismiss = (key: string, type: string, decline = false) => update((s) => ({ adjustments: answered(s.adjustments, key, decline ? type : undefined) }));
  const common = (type: string, key: string) => ({ declines: adj.declines[type] ?? 0, onNo: () => dismiss(key, type, true), onMute: () => update((s) => ({ adjustments: muted(s.adjustments, type) })) && notify(MUTED) });

  const stall = stallCard(ex, lifts, info, adj);
  const ladder = ladderCard(ex, lifts, info, { date, exclusions, ladderStay: settings.ladder_stay, adj }, getCatalog());
  const side = sidewaysOf(ex.name, exclusions, getCatalog(), where);
  const switchTo = (kind: 'up' | 'down' | 'side', to: string, key: string, msg: string) => {
    // The swap and the dismissal go together: with the settings unreadable, neither is saved.
    if (loadFailed) return void notify(NOT_SAVED);
    rules.putSwap(ladderSwap(kind, ex.name, to, date));
    dismiss(key, '');
    notify(msg);
  };

  return (
    <>
      {stall ? (
        <StallCardView
          name={ex.name}
          card={stall}
          info={info}
          side={side}
          {...common('stall', stall.key)}
          onRange={() => {
            const [lo, hi] = stall.range;
            if (update((s) => ({ exercise_overrides: withEntry(s.exercise_overrides, ex.name, stallRangeOverride(ownGet(s.exercise_overrides, ex.name), info, stall.range)), adjustments: answered(s.adjustments, stall.key) })))
              notify(`${ex.name}: now ${lo}–${hi} reps`);
          }}
          onSide={() => side && switchTo('side', side, stall.key, `Switched to ${side}`)}
        />
      ) : null}
      {ladder ? (
        <LadderCardView
          card={ladder}
          name={ex.name}
          {...common('ladder', ladder.key)}
          onSwitch={() => switchTo(ladder.kind, ladder.to, ladder.key, ladder.kind === 'up' ? `${ladder.to} starts next session` : `Switched to ${ladder.to}`)}
          onStay={() => update((s) => ({ ladder_stay: withEntry(s.ladder_stay, ex.name, ladderStayUntil(date)), adjustments: answered(s.adjustments, ladder.key) }))}
        />
      ) : null}
    </>
  );
}

/** "Ready to try X again?" for every timed rule that has ended (prototype `recheckCards`). */
export function RecheckCards({ date, lifts, rules, notify }: Props) {
  const { update: write, loadFailed } = useSettings();
  const update = guarded(write, loadFailed, notify);
  return (
    <>
      {recheckDue(rules.rules.exclusions, date).map((r) => {
        const rule = r as ExclusionRecord;
        return (
          <RecheckCard
            key={rule.id}
            rule={rule}
            onBack={() => {
              const back = recheckBack(rule, Object.keys(lifts), getCatalog().tags, date);
              // `returning` first: if it cannot be saved the rule stays as it is and the card stays.
              if (!update((s) => ({ returning: { ...s.returning, ...back.returning } }))) return;
              rules.putRule(back.rule);
              notify('Welcome back to it. Start light.');
            }}
            onLater={() => rules.putRule(recheckLater(rule, date))}
            onKeep={() => rules.putRule(recheckKeep(rule))}
          />
        );
      })}
    </>
  );
}

/** The adjustment cards from prototype `renderStart()`: "Welcome back", the optional lighter week, the recovery week, and the note while one runs. */
export function StartCards({ date, lifts, sessions, profile, plan, notify }: Omit<Props, 'rules'> & { sessions: SessionLog; profile: PlanProfile; /** Today's planned template, for the "Stick to" button. */ plan: string | null }) {
  const { settings, update: write, loadFailed } = useSettings();
  const update = guarded(write, loadFailed, notify);
  const a = settings.adjustments;
  const { deload, reentry } = rangesOf(a);
  const adj = { ...adjOf(a), deload, reentry };
  const back = reentryCard(sessions, date, adj);
  const miss = missedDay(date, { profile, sessions, weekPlan: a.weekPlan as WeekPlan | undefined, mode: a.mode as string | undefined });
  const missKey = `missed:${date}`;
  const showMiss = miss && !adj.muted?.missed && !adj.dismissed?.[missKey] ? miss : null;
  const steady = steadyCard(sessions, date, adj);
  const card = recoveryCard(lifts, date, adj);
  return (
    <>
      {back ? (
        <ReentryCardView
          card={back}
          declines={adj.declines.break ?? 0}
          onNo={() => update((s) => ({ adjustments: answered(s.adjustments, back.key, 'break') }))}
          onMute={() => update((s) => ({ adjustments: muted(s.adjustments, 'break') })) && notify(MUTED)}
          onEase={() => update((s) => ({ adjustments: startReentry(s.adjustments, date, back.key, back.pct) }))}
        />
      ) : null}
      {showMiss ? (
        <MissedCardView
          missed={showMiss}
          weekday={weekdayLong(showMiss.date)}
          stick={plan ?? 'the plan'}
          declines={adj.declines.missed ?? 0}
          onNo={() => update((s) => ({ adjustments: answered(s.adjustments, missKey, 'missed') }))}
          onMute={() => update((s) => ({ adjustments: muted(s.adjustments, 'missed') })) && notify(MUTED)}
          onShift={() => update((s) => ({ adjustments: shiftWeek(s.adjustments, missKey) })) && notify('Week shifted forward')}
        />
      ) : null}
      {steady ? (
        <SteadyCardView
          card={steady}
          declines={adj.declines['deload-plan'] ?? 0}
          onNo={() => update((s) => ({ adjustments: answered(s.adjustments, steady.key, 'deload-plan') }))}
          onMute={() => update((s) => ({ adjustments: muted(s.adjustments, 'deload-plan') })) && notify(MUTED)}
          onStart={() => update((s) => ({ adjustments: startDeload(s.adjustments, date, steady.key) })) && notify('Recovery week started')}
        />
      ) : null}
      {card ? (
        <RecoveryCardView
          card={card}
          declines={adj.declines.deload ?? 0}
          onNo={() => update((s) => ({ adjustments: answered(s.adjustments, card.key, 'deload') }))}
          onMute={() => update((s) => ({ adjustments: muted(s.adjustments, 'deload') })) && notify(MUTED)}
          onStart={() => update((s) => ({ adjustments: startDeload(s.adjustments, date, card.key) })) && notify('Recovery week started')}
        />
      ) : null}
      {deload && inRange(deload, date) ? <RangeNote text={`Recovery week until ${shortDate(deload.until)}.`} action="End it early" onEnd={() => update((s) => ({ adjustments: endAdj(s.adjustments, 'deload') }))} /> : null}
      {reentry && inRange(reentry, date) ? <RangeNote text={`Easing back in until ${shortDate(reentry.until)}.`} action="Back to normal" onEnd={() => update((s) => ({ adjustments: endAdj(s.adjustments, 'reentry') }))} /> : null}
    </>
  );
}
