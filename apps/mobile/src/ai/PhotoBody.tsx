import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { PHOTO_ADJ_MAX, PHOTO_ADJ_MIN, photoMacros, searchFoods, stepPhotoAdj } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { a11yState, Button, Card, ErrorText, Field, Hint, Label, Press } from '../components/ui';
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
import { foodToSave, logFromRow, rowsFromItems, swapFood, type PhotoRow } from './mealPhoto';
import { pickPhotoForAi } from './photo';
import { useRequest } from './useRequest';
import type { UserFood } from '../food/types';
import type { CustomFoodResult } from '@plate-and-bar/core';

const NOTE_MAX = 300;
const SWAP_SHOWN = 6;
/** The longest the busy-server wait (503 with `Retry-After`) keeps Analyse off. */
const COOLDOWN_MAX_S = 10;

/**
 * Meal photo (AI): take or choose a photo, add a note if wanted, then check the items before anything is logged. The photo
 * lives in this component's state only (in memory, never written to disk or added to progress photos) and goes with the
 * one request. `foods` are the foods on the device (the user's own first), used to match and to swap. `onClose` runs after
 * the items are logged; `onAdd` logs to the meal and the day the sheet was opened for.
 */
export function PhotoBody({ meal, foods, onAdd, onSaveMine, onAdded, onClose }: { meal: string; foods: readonly CatalogFood[]; onAdd: (n: NewLog) => void; onSaveMine: (f: Extract<CustomFoodResult, { kind: 'ok' }>['food']) => UserFood; onAdded?: (n: number) => void; onClose: () => void }) {
  const ai = useAi();
  const c = useTheme();
  const [image, setImage] = useState<AiImage | null>(null);
  const [hint, setHint] = useState('');
  const [rows, setRows] = useState<PhotoRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [save, setSave] = useState(false);
  const [wait, setWait] = useState(0);
  const req = useRequest();

  // Busy-server wait: counts down once a second; Analyse is back at zero.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const pick = async (source: 'camera' | 'library') => {
    // Choosing a photo drops any answer still on its way for the old one.
    const t = req.begin();
    setBusy(false);
    setError(null);
    try {
      const got = await pickPhotoForAi(source);
      if (!req.settle(t) || !got) return;
      setImage(got);
      setRows(null);
    } catch (e) {
      if (req.settle(t)) setError(e instanceof CameraDenied ? AI_COPY.photoCameraOff : AI_COPY.photoUnreadable);
    }
  };

  const exhausted = ai.quotaUsed();
  const analyse = async () => {
    if (req.pending() || !image || ai.quotaUsed() || wait > 0) return;
    const t = req.begin();
    setBusy(true);
    setError(null);
    const r = await ai.mealPhoto(image, isBlank(hint) ? undefined : hint.trim());
    // Cancelled, another photo chosen or the sheet closed while it was out: the answer is dropped.
    if (!req.settle(t)) return;
    setBusy(false);
    if (r.kind === 'unavailable' && r.retryAfterSec) setWait(Math.min(r.retryAfterSec, COOLDOWN_MAX_S));
    if (r.kind !== 'ok') return setError(imageFailureMessage(r, AI_COPY.photoFallback));
    if (r.data.not_food || !r.data.items.length) return setError(AI_COPY.photoNone);
    setRows(rowsFromItems(r.data.items, foods));
  };

  const update = (key: number, f: (r: PhotoRow) => PhotoRow) => setRows((rs) => rs && rs.map((r) => (r.key === key ? f(r) : r)));
  const addAll = () => {
    if (!rows) return;
    const planned: { row: PhotoRow; log: NewLog }[] = [];
    for (const r of rows) {
      const res = logFromRow(r);
      if (res.kind !== 'ok') return setError(`${r.name || 'An item'}: ${CUSTOM_MESSAGE[res.kind]}`);
      planned.push({ row: r, log: res.log });
    }
    for (const { row, log } of planned) {
      const food = save ? foodToSave(row) : null;
      if (!food) {
        onAdd(log);
        continue;
      }
      const mine = onSaveMine(food);
      // An estimate is logged as the food it was just saved as; a matched food keeps its own macros and qty.
      onAdd(row.food ? log : { ...log, name: food.name, foodId: mine.id });
    }
    onAdded?.(planned.length);
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
      {wait > 0 ? <Hint>{AI_COPY.photoServerBusy(wait)}</Hint> : null}
      {image && !exhausted && wait <= 0 ? <Button label={busy ? AI_COPY.photoBusy : AI_COPY.photoAnalyse} a11yLabel={AI_COPY.photoAnalyse} busy={busy} onPress={() => void analyse()} /> : null}
      {busy ? <Button kind="ghost" label="Cancel" a11yLabel="Cancel analysis" onPress={() => { req.cancel(); setBusy(false); }} /> : null}
      <Hint>{AI_COPY.photoPrivacy}</Hint>
      {rows ? (
        <View style={styles.inner}>
          <Label>{AI_COPY.photoReview}</Label>
          <View accessibilityLiveRegion="polite"><Hint>{AI_COPY.photoReviewHint}</Hint></View>
          {rows.map((r, n) => {
            const m = photoMacros(r.base, r.mult, r.adj);
            const who = `Item ${n + 1} ${r.name || 'unnamed'}`;
            return (
              <Card key={r.key} style={styles.gap}>
                <Field label={`Item ${n + 1} name`} value={r.name} onChangeText={(v) => update(r.key, (x) => ({ ...x, name: v, renamed: true }))} />
                <Text style={{ color: c.muted, fontSize: 14 }}>{r.portion}{r.food ? '' : ' · estimate'}{r.unsure ? ' · unsure' : ''}</Text>
                <View style={styles.row}>
                  <Press accessibilityRole="button" accessibilityLabel={`Smaller portion for ${who}`} onPress={() => update(r.key, (x) => ({ ...x, adj: stepPhotoAdj(x.adj, -1) }))} disabled={r.adj <= PHOTO_ADJ_MIN} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>−</Text></Press>
                  <Text accessibilityLabel={`Portion ${r.adj} times for ${who}`} style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>{`${r.adj}×`}</Text>
                  <Press accessibilityRole="button" accessibilityLabel={`Bigger portion for ${who}`} onPress={() => update(r.key, (x) => ({ ...x, adj: stepPhotoAdj(x.adj, 1) }))} disabled={r.adj >= PHOTO_ADJ_MAX} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>+</Text></Press>
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
          <Press accessibilityRole="checkbox" accessibilityLabel={AI_COPY.photoSave} {...a11yState({ checked: save })} onPress={() => setSave((v) => !v)} style={styles.saveRow}>
            <View style={[styles.box, { borderColor: c.brand, backgroundColor: save ? c.brand : 'transparent' }]}>{save ? <Text style={{ color: c.onBrand, fontWeight: '700' }}>✓</Text> : null}</View>
            <Text style={{ color: c.ink, flex: 1 }}>{AI_COPY.photoSave}</Text>
          </Press>
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
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  pickRow: { minHeight: 44, padding: 10, borderRadius: 8, justifyContent: 'center' },
});
