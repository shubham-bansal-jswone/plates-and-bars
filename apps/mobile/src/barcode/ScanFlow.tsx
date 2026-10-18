import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { createClient, type ApiClient } from '@plate-and-bar/api';
import { scannedFood, servingUnitTooLong, type OffMissingField, type ScannedMissingField, type OffUserFoodDraft, type UserFoodFields } from '@plate-and-bar/core';
import { CUSTOM_MESSAGE, UNIT_TOO_LONG } from '../food/copy';
import { Button, Caption, ErrorText, Field, H1, Hint, Label, Note, Page, Switch } from '../components/ui';
import { Text } from '../components/Text';
import type { NewLog } from '../food/useFoodDay';
import type { UserFood } from '../food/types';
import { API_URL } from '../sync/auth';
import { BarcodeScanScreen, type ValidBarcode } from './BarcodeScanScreen';
import { BARCODE_COPY as t, busyText, limitedText } from './copy';
import { findSaved } from './local';
import { lookupBarcode, type Found, type LookupResult } from './lookup';
import { OffCredit } from './OffCredit';

type Lookup = (code: string) => Promise<LookupResult>;
type SaveFood = (f: UserFoodFields & { barcode: string }) => UserFood;

type Problem = Exclude<LookupResult, { kind: 'found' }>['kind'];

type Step =
  | { k: 'scan'; round: number }
  | { k: 'looking'; code: string }
  | { k: 'problem'; code: string; problem: Problem; after: number | null }
  | { k: 'review'; code: string; draft: OffUserFoodDraft; missing: OffMissingField[]; found: Found | null; saved: UserFood | null };

interface Props {
  meal: string;
  /** The user's saved foods: a scanned code found here is opened with no lookup. */
  mine: readonly UserFood[];
  onAdd: (n: NewLog) => void;
  onSaveMine: SaveFood;
  /** "Enter by hand": the caller opens its Custom form with this code. */
  onCustom: (code: string) => void;
  /** Close and Android back: back to the Food list, the Add sheet stays open. */
  onClose: () => void;
  /** Add was pressed and the food is logged: close the whole Add sheet. */
  onDone: () => void;
  /** Tests inject a lookup; the app builds a token-less client for `EXPO_PUBLIC_API_URL`. */
  lookup?: Lookup;
}

/**
 * Scan barcode (#944): scanner screen, then (local saved food first, else one lookup through our server) a review sheet with
 * every number editable, then Add. Every failure has a way out to the Custom form. Nothing here blocks on the network: the
 * lookup is one request and the rest of the app keeps working underneath.
 */
export function ScanFlow({ meal, mine, onAdd, onSaveMine, onCustom, onClose, onDone, lookup }: Props) {
  const api = useMemo<ApiClient | null>(() => (API_URL ? createClient(API_URL, () => null) : null), []);
  const [step, setStep] = useState<Step>({ k: 'scan', round: 0 });
  const live = useRef(true);
  const run = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const start = useCallback(
    async (code: string, retry = false) => {
      // A repeat scan of a saved food needs no network at all.
      const saved = retry ? undefined : findSaved(mine, code);
      if (saved) {
        setStep({ k: 'review', code, draft: draftOf(saved), missing: [], found: null, saved });
        return;
      }
      if (!lookup && !api) {
        // A build with no server cannot look anything up: the same way out as no connection.
        setStep({ k: 'problem', code, problem: 'offline', after: null });
        return;
      }
      const id = ++run.current;
      setStep({ k: 'looking', code });
      const r = await (lookup ? lookup(code) : lookupBarcode(api as ApiClient, code));
      if (!live.current || id !== run.current) return;
      if (r.kind === 'found') setStep({ k: 'review', code, draft: r.draft, missing: r.missing, found: r, saved: null });
      else setStep({ k: 'problem', code, problem: r.kind, after: 'retryAfterSec' in r ? r.retryAfterSec : null });
    },
    [api, lookup, mine],
  );

  // The scanner has already validated with core (and the scanner's format hint) and expanded a UPC-E: `code` is 8, 12 or 13 digits.
  const onCode = (b: ValidBarcode) => void start(b.code);
  const again = () => {
    run.current++;
    setStep((s) => ({ k: 'scan', round: s.k === 'scan' ? s.round + 1 : 1 }));
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {step.k === 'scan' ? <BarcodeScanScreen key={step.round} onCode={onCode} onClose={onClose} /> : null}
      {step.k === 'looking' ? (
        <Page>
          <H1>{t.title}</H1>
          <Text accessibilityRole="alert" style={styles.line}>{t.looking}</Text>
          <Button kind="ghost" label={t.close} onPress={() => { run.current++; onClose(); }} />
        </Page>
      ) : null}
      {step.k === 'problem' ? <ProblemView step={step} onRetry={() => void start(step.code, true)} onCustom={() => onCustom(step.code)} onScan={again} onClose={onClose} /> : null}
      {step.k === 'review' ? <Review step={step} meal={meal} onAdd={onAdd} onSaveMine={onSaveMine} onScan={again} onClose={onClose} onDone={onDone} /> : null}
    </Modal>
  );
}

const draftOf = (f: UserFood): OffUserFoodDraft => ({
  name: f.name, unit: f.unit, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fibre_g: f.fibre_g, added_sugar_g: f.added_sugar_g,
  fruit_veg_servings: null, origin: 'custom', barcode: f.barcode ?? null,
});

function ProblemView({ step, onRetry, onCustom, onScan, onClose }: { step: Extract<Step, { k: 'problem' }>; onRetry: () => void; onCustom: () => void; onScan: () => void; onClose: () => void }) {
  const p = step.problem;
  const text =
    p === 'not_found' ? t.notFound : p === 'offline' ? t.offline : p === 'busy' ? busyText(step.after) : p === 'rate_limited' ? limitedText(step.after) : p === 'invalid' ? t.invalid : t.lookupDown;
  const retry = p === 'offline' || p === 'busy' || p === 'rate_limited' || p === 'unavailable';
  return (
    <Page>
      <H1>{t.title}</H1>
      <Text accessibilityRole="alert" style={styles.line}>{text}</Text>
      {p === 'invalid' ? <Button label={t.scanAgain} onPress={onScan} /> : <Button label={t.byHand} onPress={onCustom} />}
      {retry ? <Button kind="ghost" label={t.tryAgain} onPress={onRetry} /> : null}
      {p !== 'invalid' ? <Button kind="link" label={t.scanAgain} onPress={onScan} /> : null}
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}

type Form = { name: string; unit: string; kcal: string; protein: string; carbs: string; fat: string };
const text = (n: number | null): string => (n === null ? '' : String(n));

function Review({ step, meal, onAdd, onSaveMine, onScan, onClose, onDone }: { onDone: () => void; step: Extract<Step, { k: 'review' }>; meal: string; onAdd: (n: NewLog) => void; onSaveMine: SaveFood; onScan: () => void; onClose: () => void }) {
  const { draft, found, saved } = step;
  const [f, setF] = useState<Form>({ name: draft.name, unit: draft.unit, kcal: text(draft.kcal), protein: text(draft.protein_g), carbs: text(draft.carbs_g), fat: text(draft.fat_g) });
  const [qty, setQty] = useState('1');
  const [save, setSave] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (v: string) => { setF((o) => ({ ...o, [k]: v })); setError(null); };
  // Core's scannedFood: all four numbers must be entered and a typed 0 is a real value (water, diet soda), so "0" counts as filled and "" does not.
  const r = scannedFood({ ...f, qty });
  const missingFields = r.kind === 'missing' ? r.fields : [];
  const flagged = (k: ScannedMissingField): boolean => missingFields.includes(k);
  const nameFlag = f.name.trim() === '';

  const submit = () => {
    if (r.kind === 'missing') return;
    if (r.kind !== 'ok') return setError(CUSTOM_MESSAGE[r.kind]);
    const food: UserFoodFields & { barcode: string } = {
      ...r.food,
      unit: f.unit.trim() || draft.unit,
      fibre_g: draft.fibre_g,
      added_sugar_g: draft.added_sugar_g,
      fruit_veg_servings: null,
      barcode: saved?.barcode ?? step.code, // a saved food keeps the code it was saved under (12 or 13 digits)
    };
    // Only a saved food carries the unit, so a long unit blocks only when it would be saved (as on the Custom tab).
    if ((save || saved) && servingUnitTooLong(food.unit)) return setError(UNIT_TOO_LONG);
    let foodId: string | null = null;
    if (saved && !changed(saved, food)) foodId = saved.id;
    else if (save || saved) foodId = onSaveMine(food).id;
    onAdd({ ...r.log, foodId });
    onDone();
  };

  const warnings = found ? [found.warnings.includes('looks_off') ? t.looksOff : null, found.warnings.some((w) => w === 'low_completeness' || w === 'nutrition_to_be_completed') ? t.incomplete : null, found.warnings.includes('quality_errors') ? t.qualityErrors : null] : [];
  return (
    <Page>
      <H1>{t.title}</H1>
      {found ? <Hint>{t.lookupNote}</Hint> : <Hint>{t.savedNote}</Hint>}
      <Note>{t.banner}</Note>
      {warnings.map((w) => (w ? <ErrorText key={w}>{w}</ErrorText> : null))}
      {found?.carbsFibreHint ? <Hint>{t.carbsFibre}</Hint> : null}
      {found?.liquid ? <Hint>{t.liquid}</Hint> : null}
      <Captioned label={t.name} flag={nameFlag}><Field label={t.name} value={f.name} onChangeText={set('name')} /></Captioned>
      <Captioned label={t.serving}><Field label={t.serving} value={f.unit} onChangeText={set('unit')} /></Captioned>
      <View style={styles.grid}>
        <Captioned label={t.calories} flag={flagged('kcal')}><Field label={t.calories} keyboardType="decimal-pad" value={f.kcal} onChangeText={set('kcal')} /></Captioned>
        <Captioned label={t.protein} flag={flagged('protein_g')}><Field label={t.protein} keyboardType="decimal-pad" value={f.protein} onChangeText={set('protein')} /></Captioned>
        <Captioned label={t.carbs} flag={flagged('carbs_g')}><Field label={t.carbs} keyboardType="decimal-pad" value={f.carbs} onChangeText={set('carbs')} /></Captioned>
        <Captioned label={t.fat} flag={flagged('fat_g')}><Field label={t.fat} keyboardType="decimal-pad" value={f.fat} onChangeText={set('fat')} /></Captioned>
        <Captioned label="Servings"><Field label="Servings" keyboardType="decimal-pad" value={qty} onChangeText={setQty} /></Captioned>
      </View>
      <OffCredit code={step.code} />
      {saved ? null : (
        <View style={styles.row}>
          <Switch accessibilityLabel={t.save} value={save} onValueChange={setSave} />
          <Label>{t.save}</Label>
        </View>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={`Add to ${meal.toLowerCase()}`} a11yLabel={`Add to ${meal.toLowerCase()}`} onPress={submit} disabled={r.kind === 'missing' || r.kind === 'no-name'} />
      <Button kind="ghost" label={t.scanAgain} onPress={onScan} />
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}

/** True when the saved food's numbers, name or serving differ from the edited ones. */
function changed(saved: UserFood, f: UserFoodFields): boolean {
  return saved.name !== f.name || saved.unit !== f.unit || saved.kcal !== f.kcal || saved.protein_g !== f.protein_g || saved.carbs_g !== f.carbs_g || saved.fat_g !== f.fat_g;
}

function Captioned({ label, flag, children }: { label: string; flag?: boolean; children: ReactNode }) {
  return (
    <View style={styles.captioned}>
      <Caption>{label}</Caption>
      {children}
      {flag ? <ErrorText>{t.missing}</ErrorText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  captioned: { gap: 4, minWidth: 120, flexGrow: 1 },
});
