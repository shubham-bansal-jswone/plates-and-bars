import { ladderCard, ladderStayUntil, ladderSwap, recheckBack, recheckDue, recheckKeep, recheckLater, sidewaysOf, stallCard, stallRangeOverride, type ExInfo, type LiftRecord, type Where } from '@plate-and-bar/core';
import type { ExclusionRecord } from '../db/rules';
import { useSettings } from '../state/SettingsProvider';
import { adjOf, answered, muted } from './adjust';
import { catalog } from './catalog';
import { LadderCardView, RecheckCard, StallCardView } from './AdjustCards';
import type { ExState } from './model';
import type { useRules } from './useRules';

type Rules = ReturnType<typeof useRules>;

const NOT_SAVED = 'Couldn’t save that: your settings didn’t load. Restart the app and try again.';

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
  const common = (type: string, key: string) => ({ declines: adj.declines[type] ?? 0, onNo: () => dismiss(key, type, true), onMute: () => update((s) => ({ adjustments: muted(s.adjustments, type) })) });

  const stall = stallCard(ex, lifts, info, adj);
  const ladder = ladderCard(ex, lifts, info, { date, exclusions, ladderStay: settings.ladder_stay, adj }, catalog);
  const side = sidewaysOf(ex.name, exclusions, catalog, where);
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
            if (update((s) => ({ exercise_overrides: { ...s.exercise_overrides, [ex.name]: stallRangeOverride(s.exercise_overrides[ex.name], info, stall.range) }, adjustments: answered(s.adjustments, stall.key) })))
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
              const back = recheckBack(rule, Object.keys(lifts), catalog.tags, date);
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
