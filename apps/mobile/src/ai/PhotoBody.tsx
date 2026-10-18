import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { searchFoods } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, ErrorText, Field, Hint, Label, Press } from '../components/ui';
import type { CatalogFood } from '../food/catalog';
import { CUSTOM_MESSAGE } from '../food/copy';
import { fmt } from '../format';
import { CameraDenied } from '../photos/capture';
import { useTheme } from '../theme/useTheme';
import { isBlank } from '../text/blank';
import type { NewLog } from '../food/useFoodDay';
import { useAi } from './AiProvider';
import type { AiImage } from './client';
import { AI_COPY, failureMessage, imageFailureMessage } from './copy';
import { logFromRow, PHOTO_ADJ_MAX, PHOTO_ADJ_MIN, rowMacros, rowsFromItems, stepAdj, swapFood, type PhotoRow } from './mealPhoto';
import { pickPhotoForAi } from './photo';

const NOTE_MAX = 300;
const SWAP_SHOWN = 6;

/**
 * Meal photo (AI): take or choose a photo, add a note if wanted, then check the items before anything is logged. The photo
 * lives in this component's state only (in memory, never written to disk or added to progress photos) and goes with the
 * one request. `foods` are the foods on the device (the user's own first), used to match and to swap. `onClose` runs after
 * the items are logged; `onAdd` logs to the meal and the day the sheet was opened for.
 */
export function PhotoBody({ meal, foods, onAdd, onClose }: { meal: string; foods: readonly CatalogFood[]; onAdd: (n: NewLog) => void; onClose: () => void }) {
  const ai = useAi();
  const c = useTheme();
  const [image, setImage] = useState<AiImage | null>(null);
  const [hint, setHint] = useState('');
  const [rows, setRows] = useState<PhotoRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => void (alive.current = false), []);

  const pick = async (source: 'camera' | 'library') => {
    if (inFlight.current) return;
    setError(null);
    try {
      const got = await pickPhotoForAi(source);
      if (!alive.current || !got) return;
      setImage(got);
      setRows(null);
    } catch (e) {
      if (alive.current) setError(e instanceof CameraDenied ? AI_COPY.photoCameraOff : AI_COPY.photoUnreadable);
    }
  };

  const exhausted = ai.quotaUsed();
  const analyse = async () => {
    if (inFlight.current || !image || ai.quotaUsed()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await ai.mealPhoto(image, isBlank(hint) ? undefined : hint.trim());
    inFlight.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(imageFailureMessage(r, AI_COPY.photoFallback));
    if (r.data.not_food || !r.data.items.length) return setError(AI_COPY.photoNone);
    setRows(rowsFromItems(r.data.items, foods));
  };

  const update = (key: number, f: (r: PhotoRow) => PhotoRow) => setRows((rs) => rs && rs.map((r) => (r.key === key ? f(r) : r)));
  const addAll = () => {
    if (!rows) return;
    const logs: NewLog[] = [];
    for (const r of rows) {
      const res = logFromRow(r);
      if (res.kind !== 'ok') return setError(`${r.name || 'An item'}: ${CUSTOM_MESSAGE[res.kind]}`);
      logs.push(res.log);
    }
    logs.forEach(onAdd);
    onClose();
  };

  const shown = swapping === null ? [] : searchFoods(query, foods).slice(0, SWAP_SHOWN);
  return (
    <View style={styles.inner}>
      {image ? <Image source={{ uri: `data:${image.media_type};base64,${image.data}` }} accessibilityLabel="Your meal photo" resizeMode="cover" style={[styles.preview, { backgroundColor: c.surfaceSoft }]} /> : <Hint>{AI_COPY.photoHint}</Hint>}
      <View style={styles.row}>
        <Button kind="ghost" label={image ? AI_COPY.photoAnother : AI_COPY.photoTake} a11yLabel={image ? AI_COPY.photoAnother : AI_COPY.photoTake} onPress={() => void pick('camera')} />
        <Button kind="ghost" label={AI_COPY.photoChoose} onPress={() => void pick('library')} />
      </View>
      <Field label={AI_COPY.photoNoteLabel} placeholder={AI_COPY.photoNotePlaceholder} multiline maxLength={NOTE_MAX} value={hint} onChangeText={setHint} />
      {exhausted ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.photoFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
      {image && !exhausted ? <Button label={busy ? AI_COPY.photoBusy : AI_COPY.photoAnalyse} a11yLabel={AI_COPY.photoAnalyse} busy={busy} onPress={() => void analyse()} /> : null}
      <Hint>{AI_COPY.photoPrivacy}</Hint>
      {rows ? (
        <View style={styles.inner}>
          <Label>{AI_COPY.photoReview}</Label>
          <View accessibilityLiveRegion="polite"><Hint>{AI_COPY.photoReviewHint}</Hint></View>
          {rows.map((r, n) => {
            const m = rowMacros(r);
            const who = `Item ${n + 1} ${r.name || 'unnamed'}`;
            return (
              <Card key={r.key} style={styles.gap}>
                <Field label={`Item ${n + 1} name`} value={r.name} onChangeText={(v) => update(r.key, (x) => ({ ...x, name: v }))} />
                <Text style={{ color: c.muted, fontSize: 14 }}>{r.portion}{r.food ? '' : ' · estimate'}{r.unsure ? ' · unsure' : ''}</Text>
                <View style={styles.row}>
                  <Press accessibilityRole="button" accessibilityLabel={`Smaller portion for ${who}`} onPress={() => update(r.key, (x) => ({ ...x, adj: stepAdj(x.adj, -1) }))} disabled={r.adj <= PHOTO_ADJ_MIN} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>−</Text></Press>
                  <Text accessibilityLabel={`Portion ${r.adj} times for ${who}`} style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>{`${r.adj}×`}</Text>
                  <Press accessibilityRole="button" accessibilityLabel={`Bigger portion for ${who}`} onPress={() => update(r.key, (x) => ({ ...x, adj: stepAdj(x.adj, 1) }))} disabled={r.adj >= PHOTO_ADJ_MAX} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>+</Text></Press>
                </View>
                <Text style={{ color: c.ink }}>{`${fmt(m.kcal)} kcal, ${fmt(m.protein_g)} g protein, ${fmt(m.carbs_g)} g carbs, ${fmt(m.fat_g)} g fat`}</Text>
                <View style={styles.row}>
                  <Button kind="link" label="Swap" a11yLabel={`Swap ${who} for a food from your list`} onPress={() => { setSwapping(swapping === r.key ? null : r.key); setQuery(''); }} expanded={swapping === r.key} />
                  <Button kind="link" label="Remove" a11yLabel={`Remove ${who}`} onPress={() => setRows((rs) => (rs ? rs.filter((x) => x.key !== r.key) : rs))} />
                </View>
                {swapping === r.key ? (
                  <View style={styles.gap}>
                    <Field label={`Search foods to swap ${who}`} placeholder="Search roti, paneer, whey…" value={query} onChangeText={setQuery} />
                    {shown.map((f) => (
                      <Press key={`${f.id}:${f.name}`} accessibilityRole="button" accessibilityLabel={`Use ${f.name} for ${who}, ${f.serving.label}`} onPress={() => { update(r.key, (x) => swapFood(x, f)); setSwapping(null); }} style={[styles.pickRow, { backgroundColor: c.surface }]}>
                        <Text style={{ color: c.ink, fontWeight: '600' }}>{f.name}</Text>
                        <Text style={{ color: c.muted, fontSize: 14 }}>{f.serving.label}</Text>
                      </Press>
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          })}
          <Hint>{AI_COPY.photoOilHint}</Hint>
          {rows.length ? <Button label={`Add ${rows.length} item${rows.length > 1 ? 's' : ''} to ${meal.toLowerCase()}`} onPress={addAll} /> : <Hint>Nothing left to add.</Hint>}
          <Hint>{AI_COPY.aiNote}</Hint>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { gap: 10 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  preview: { width: '100%', height: 200, borderRadius: 8 },
  step: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pickRow: { minHeight: 44, padding: 10, borderRadius: 8, justifyContent: 'center' },
});
