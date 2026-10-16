import { dailyRead } from '@plate-and-bar/core';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Hint } from '../components/ui';
import { Text } from '../components/Text';
import { localDate } from '../setup/logic';
import { useOptionalSettings } from '../state/SettingsProvider';
import { useTheme } from '../theme/useTheme';
import { chosenCards, HIDDEN_CARDS, type WhyValues } from './cards';
import { readLearn } from './learn';
import { WhySheet } from './WhyLink';

/** Prototype `learnCardHtml`: the next 2-minute read, one more every 3 days; nothing once the due cards are read. */
export function DailyRead({ sex, values, now = () => new Date() }: { sex?: string; values?: WhyValues; now?: () => Date }) {
  const c = useTheme();
  const s = useOptionalSettings();
  const [open, setOpen] = useState<string | null>(null);
  const today = localDate(now());
  const learn = s?.settings.learn ?? {};
  const { start, read } = readLearn(learn);
  const ready = s?.ready === true;
  const update = s?.update;
  // The clock starts the first time the card is shown (prototype sets `learn.start` there).
  useEffect(() => {
    if (ready && start === null && update) update((x) => ({ learn: { ...x.learn, start: today } }));
  }, [ready, start, today, update]);
  if (!s || !ready) return null;
  const { next, readN, total } = dailyRead(chosenCards().cards, sex, { start, read }, today, HIDDEN_CARDS);
  // The sheet stays up after the read mark moves the card on.
  if (!next && !open) return null;
  return (
    <>
      {next ? (
        <View style={[styles.box, { borderColor: c.brand }]}>
          <View style={styles.text}>
            <Hint>{`2-minute read, ${readN} of ${total} done`}</Hint>
            <Text style={{ color: c.ink, fontWeight: '700' }}>{next.title}</Text>
          </View>
          <Button kind="ghost" label="Read" a11yLabel={`Read ${next.title}`} onPress={() => setOpen(next.id)} />
        </View>
      ) : null}
      {open ? <WhySheet id={open} values={values} now={now} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed' },
  text: { flex: 1 },
});
