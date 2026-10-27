import { useEffect, useRef, useState } from 'react';
import { SheetModal } from '../components/Sheet';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ExerciseTag } from '@plate-and-bar/core';
import { useAi } from '../ai/AiProvider';
import { AI_COPY, failureMessage } from '../ai/copy';
import { Button, ErrorText, Heading, Hint, Label, Chip } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { BodyMap } from './BodyMap';
import { MUSCLE_CODES, muscleName } from './copy';
import { FALLBACK_TAGS, tagsFromSuggestion } from './suggestTags';
import { isBlank } from '../text/blank';

/**
 * Tags for an exercise the user typed (prototype `tagSheet`): the muscles it trains, so it gets coverage, swaps and weight
 * guidance. When AI is on and the quota is not used up, the sheet asks for a suggestion (only the name is sent) and shows it
 * for the user to correct on the body map and the chips. Any other case (off, no consent, quota, offline, a reply with no
 * main muscle) is the manual sheet with the prototype's fallback tags. Nothing waits on the network: Cancel works while
 * the suggestion is out, and a late answer after the sheet closed is dropped.
 */
export function CustomTagsSheet({ name, onSave, onClose }: { name: string; onSave: (tags: ExerciseTag) => void; onClose: () => void }) {
  const c = useTheme();
  const ai = useAi();
  const [base, setBase] = useState<ExerciseTag>(FALLBACK_TAGS);
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<string[]>([]);
  const [missing, setMissing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(AI_COPY.suggestFallback);
  const alive = useRef(true);
  const asked = useRef(false);
  useEffect(() => () => void (alive.current = false), []);
  useEffect(() => {
    if (asked.current || isBlank(name) || !ai.available('suggest_tags') || ai.quotaUsed()) return;
    asked.current = true;
    setBusy(true);
    ai.suggestTags(name).then((r) => {
      if (!alive.current) return;
      setBusy(false);
      // This sheet has no retry, so the "wait and try again" and "shorten it" wordings do not fit.
      if (r.kind !== 'ok') return setNote(r.kind === 'rate_limited' || r.kind === 'invalid' ? `${AI_COPY.suggestNoRetry} ${AI_COPY.suggestFallback}` : failureMessage(r, AI_COPY.suggestFallback));
      const t = tagsFromSuggestion(r.data);
      if (!t) return setNote(AI_COPY.suggestFallback);
      setBase(t);
      setPrimary([...t.primary]);
      setSecondary([...t.secondary]);
      setNote(AI_COPY.suggestDone);
    });
  }, [ai, name]);
  // The suggestion is only asked for while the user has not picked anything: a status read that lands late must not replace their picks.
  const toggle = (list: string[], set: (l: string[]) => void, m: string) => {
    asked.current = true;
    setMissing(0);
    set(list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  };
  const save = () => {
    // One alert only: a toast as well would be read twice by a screen reader. Nonce so a repeat press re-announces.
    if (!primary.length) return setMissing((n) => n + 1);
    onSave({ ...base, primary, secondary });
  };
  return (
    <SheetModal title={name} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
          {name}
        </Heading>
        {busy ? (
          <Hint>{AI_COPY.suggestWorking}</Hint>
        ) : (
          <>
            <Hint>{note} Tags let it show on the body map, count toward coverage and get swaps.</Hint>
            <BodyMap primary={primary} secondary={secondary} />
            <Label>Main muscles</Label>
            <View style={styles.chips}>
              {MUSCLE_CODES.map((m) => (
                <Chip key={m} label={`Main muscle: ${muscleName(m)}`} text={muscleName(m)} pressed={primary.includes(m)} onPress={() => toggle(primary, setPrimary, m)} />
              ))}
            </View>
            <Label>Also working</Label>
            <View style={styles.chips}>
              {MUSCLE_CODES.map((m) => (
                <Chip key={m} label={`Also working: ${muscleName(m)}`} text={muscleName(m)} pressed={secondary.includes(m)} onPress={() => toggle(secondary, setSecondary, m)} />
              ))}
            </View>
            {missing ? <ErrorText key={missing}>Choose a main muscle first.</ErrorText> : null}
            <Button label="Add exercise" a11yLabel={`Add ${name} with these muscles`} onPress={save} />
          </>
        )}
        <Button label="Cancel" kind="ghost" onPress={onClose} />
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
