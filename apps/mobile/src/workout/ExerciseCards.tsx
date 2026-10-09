import { ladderCard, ladderStayUntil, ladderSwap, recheckBack, recheckDue, recheckKeep, recheckLater, sidewaysOf, stallCard, stallRangeOverride, type ExInfo, type LiftRecord } from '@plate-and-bar/core';
import type { ExclusionRecord } from '../db/rules';
import { useSettings } from '../state/SettingsProvider';
import { adjOf, answered, muted } from './adjust';
import { catalog } from './catalog';
import { LadderCardView, RecheckCard, StallCardView } from './AdjustCards';
import type { ExState } from './model';
import type { useRules } from './useRules';

type Rules = ReturnType<typeof useRules>;

interface Props {
  date: string;
  lifts: Readonly<Record<string, LiftRecord>>;
  rules: Rules;
  notify: (msg: string) => void;
}

/** The stall card, or else the ladder card, under an exercise's suggestion (prototype `stallCard` then `ladderCard`). */
export function ExerciseCards({ ex, info, date, lifts, rules, notify }: Props & { ex: ExState; info: ExInfo }) {
  const { settings, update } = useSettings();
  const adj = adjOf(settings.adjustments);
  const exclusions = rules.rules.exclusions;
  const dismiss = (key: string, type: string, decline = false) => update((s) => ({ adjustments: answered(s.adjustments, key, decline ? type : undefined) }));
  const common = (type: string, key: string) => ({ declines: adj.declines[type] ?? 0, onNo: () => dismiss(key, type, true), onMute: () => update((s) => ({ adjustments: muted(s.adjustments, type) })) });

  const stall = stallCard(ex, lifts, info, adj);
  const ladder = ladderCard(ex, lifts, info, { date, exclusions, ladderStay: settings.ladder_stay, adj }, catalog);
  // TODO(#273): pass the day's `where` (else the profile's) once core's sidewaysOf takes it.
  const side = sidewaysOf(ex.name, exclusions, catalog);
  const switchTo = (kind: 'up' | 'down' | 'side', to: string, key: string, msg: string) => {
    rules.putSwap(ladderSwap(kind, ex.name, to, date));
    dismiss(key, '');
    notify(msg);
  };

  return (
    <>
      {stall ? (
        <StallCardView
          card={stall}
          info={info}
          side={side}
          {...common('stall', stall.key)}
          onRange={() => {
            const [lo, hi] = stall.range;
            update((s) => ({ exercise_overrides: { ...s.exercise_overrides, [ex.name]: stallRangeOverride(s.exercise_overrides[ex.name], info, stall.range) }, adjustments: answered(s.adjustments, stall.key) }));
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
          onStay={() => update((s) => ({ ladder_stay: { ...s.ladder_stay, [ex.name]: ladderStayUntil(date) }, adjustments: answered(s.adjustments, ladder.key) }))}
        />
      ) : null}
    </>
  );
}

/** "Ready to try X again?" for every timed rule that has ended (prototype `recheckCards`). */
export function RecheckCards({ date, lifts, rules, notify }: Props) {
  const { update } = useSettings();
  return (
    <>
      {recheckDue(rules.rules.exclusions, date).map((r) => {
        const rule = r as ExclusionRecord;
        return (
          <RecheckCard
            key={rule.id}
            rule={rule}
            onBack={() => {
              const back = recheckBack(rule, Object.keys(lifts), catalog.tags, date);
              rules.putRule(back.rule);
              update((s) => ({ returning: { ...s.returning, ...back.returning } }));
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
