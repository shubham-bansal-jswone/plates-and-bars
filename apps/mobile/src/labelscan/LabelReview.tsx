import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { servingUnitTooLong, type LabelDraft, type UserFoodFields } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Caption, ErrorText, Field, H1, Hint, Label, Note, Page, Switch } from '../components/ui';
import { CUSTOM_MESSAGE, UNIT_TOO_LONG } from '../food/copy';
import type { NewLog } from '../food/useFoodDay';
import { useTheme } from '../theme/useTheme';
import { LABEL_COPY as t, WARNING_COPY } from './copy';
import { useFocusOnMount } from './focus';
import { flagOf, foodOf, formOf, readOf, REVIEW_FIELDS, type Form, type ReviewKey } from './review';
import type { UserFood } from '../food/types';

interface Props {
  meal: string;
  draft: LabelDraft;
  onAdd: (n: NewLog) => void;
  onSaveMine: (f: UserFoodFields) => UserFood;
  onScanAgain: () => void;
  onClose: () => void;
  onDone: () => void;
}

/**
 * The mandatory review (ADR 010 item 5): every value is shown and editable, low and missing ones start empty, medium ones say
 * "check this" in words, and Add stays off until the name, calories, protein, carbs and fat are all set. This is the only way
 * from the camera to a saved food. Nothing of the photo is here: only the numbers.
 */
export function LabelReview({ meal, draft, onAdd, onSaveMine, onScanAgain, onClose, onDone }: Props) {
  const c = useTheme();
  const focus = useFocusOnMount();
  const [perServing, setPerServing] = useState(false);
  const read = readOf(draft, perServing);
  const [f, setF] = useState<Form>(() => formOf(draft));
  const [save, setSave] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    setError(null);
  };
  const switchTo = (on: boolean) => {
    setPerServing(on);
    // The other read has its own numbers and serving; the name the user typed stays.
    setF((o) => formOf(readOf(draft, on), o.name));
    setError(null);
  };

  const r = foodOf(read, f);
  const blocked = r.kind === 'missing' || r.kind === 'no-name';
  const submit = () => {
    if (r.kind === 'missing') return;
    if (r.kind === 'invalid') return setError(t.invalid);
    if (r.kind !== 'ok') return setError(CUSTOM_MESSAGE[r.kind]);
    if (save && servingUnitTooLong(r.food.unit)) return setError(UNIT_TOO_LONG);
    onAdd({ ...r.log, foodId: save ? onSaveMine(r.food).id : null });
    onDone();
  };

  const basis = read.basis === 'per100' ? t.basis100(read.unit) : read.basis === 'per_serving' && read.unit ? t.basisServing(read.unit) : t.basisUnknown;
  const flag = (k: ReviewKey): ReactNode => {
    const level = read.fields[k].level;
    const fl = flagOf(level);
    if (fl === 'check') return <Text style={[styles.check, { color: c.ink, borderColor: c.line, backgroundColor: c.tint }]}>{t.check}</Text>;
    if (fl === 'empty' && !f[k]) return <ErrorText>{REVIEW_FIELDS.find((x) => x.key === k)?.required ? t.notRead : `${t.notRead} ${t.optional}`}</ErrorText>;
    return null;
  };

  return (
    <Page resetKey={perServing}>
      <View ref={focus} accessible><H1>{t.reviewTitle}</H1></View>
      <Note>{t.reviewIntro}</Note>
      <Label>{basis}</Label>
      {draft.alternate ? (
        <View style={styles.row}>
          <Switch accessibilityLabel={t.perServing} value={perServing} onValueChange={switchTo} />
          <Label>{t.perServing}</Label>
        </View>
      ) : null}
      {read.warnings.map((w) => <ErrorText key={w}>{WARNING_COPY[w]}</ErrorText>)}
      <Caption>{t.name}</Caption>
      <Field label={t.name} value={f.name} onChangeText={set('name')} />
      {f.name.trim() === '' ? <Hint>{t.nameHint}</Hint> : null}
      <Caption>{t.serving}</Caption>
      <Field label={t.serving} value={f.unit} onChangeText={set('unit')} />
      <View style={styles.grid}>
        {REVIEW_FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.captioned}>
            <Caption>{t[label]}</Caption>
            <Field label={t[label]} keyboardType="decimal-pad" value={f[key]} onChangeText={set(key)} />
            {flag(key)}
          </View>
        ))}
      </View>
      <View style={styles.row}>
        <Switch accessibilityLabel={t.save} value={save} onValueChange={setSave} />
        <Label>{t.save}</Label>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={`Add to ${meal.toLowerCase()}`} onPress={submit} disabled={blocked} />
      <Button kind="ghost" label={t.tryAgain} onPress={onScanAgain} />
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  captioned: { gap: 4, minWidth: 140, flexGrow: 1 },
  check: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 14, fontWeight: '600' },
});
