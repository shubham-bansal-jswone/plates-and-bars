import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { isFlagged, labHistory, labResult, tipFor, validateLabReport, type LabReport, type LabTest } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { SheetModal } from '../components/Sheet';
import { Button, Card, ErrorText, Field, Heading, Hint, Note, Chip } from '../components/ui';
import { shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { labs, tipText } from './content';
import {
  FLAG_WORD, LABS_ADD, LABS_ADD_TEST, LABS_ALL, LABS_COUNT, LABS_DATE_LABEL, LABS_DATE_PLACEHOLDER, LABS_DELETE, LABS_DELETE_AGAIN, LABS_DISCARD, LABS_FIELD, LABS_LATEST, LABS_PLACEHOLDER,
  LABS_PRIVATE, LABS_RANGE, LABS_REMOVE_TEST, LABS_SAVE, LABS_SEEN_DOCTOR, LABS_SHEET_TITLE, LABS_TEST_N, LABS_TITLE, LABS_TREND, LAB_ERRORS,
} from './copy';
import type { Labs } from './useLabs';

const BLANK: LabTest = { name: '', value: '', unit: '', low: '', high: '' };
const FIELDS = ['name', 'value', 'unit', 'low', 'high'] as const;
const NUMERIC = new Set<string>(['value', 'low', 'high']);

/** One row's problem: the first one core finds for that test alone (the date is checked on its own). */
const rowError = (t: LabTest) => validateLabReport({ id: '', date: '2000-01-01', tests: [t] });

/**
 * Progress tab, "Lab reports" (prototype `labsShellHtml` and `renderLabs`): the doctor-review banner while the hold is on, entry by hand
 * (no upload, no AI), the results of a saved report with a flag word and a tip per flagged test, a trend per test across reports, and delete.
 * Device only. The wording is informational, never a diagnosis; it comes from content/labs.json.
 */
export function LabsSection({ labs: l, today }: { labs: Labs; today: string }) {
  const c = useTheme();
  const [adding, setAdding] = useState(false);
  const [armed, setArmed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000); // a stray tap much later must not delete the reports
    return () => clearTimeout(timer);
  }, [armed]);
  if (!l.enabled || !l.reports) return null;
  const reports = l.reports;
  const shown = reports.find((r) => r.id === picked) ?? reports[reports.length - 1];
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{LABS_TITLE}</Heading>
      <Hint>{labs.intro}</Hint>
      <Hint>{labs.not_medical_advice}</Hint>
      {l.holdOn ? (
        <Card accessibilityRole="alert">
          <Text style={{ color: c.ink, fontWeight: '700' }}>{labs.hold_title}</Text>
          <Hint>{labs.hold_body}</Hint>
          <Button label={LABS_SEEN_DOCTOR} onPress={() => void l.seenDoctor()} />
        </Card>
      ) : null}
      <Button kind="ghost" label={LABS_ADD} onPress={() => setAdding(true)} />
      {shown ? <Results reports={reports} shown={shown} onPick={setPicked} /> : null}
      {reports.length ? (
        <>
          <Hint>{LABS_COUNT(reports.length)}</Hint>
          <Button
            label={armed ? LABS_DELETE_AGAIN : LABS_DELETE}
            kind="link"
            onPress={() => {
              if (!armed) return setArmed(true);
              setArmed(false);
              setPicked(null);
              void l.deleteAll();
            }}
          />
        </>
      ) : null}
      <Hint>{LABS_PRIVATE}</Hint>
      {adding ? (
        <AddForm
          today={today}
          onClose={() => setAdding(false)}
          onSave={async (r) => {
            if (await l.save(r)) {
              setPicked(null);
              setAdding(false);
            }
          }}
        />
      ) : null}
    </View>
  );
}

function Results({ reports, shown, onPick }: { reports: readonly LabReport[]; shown: LabReport; onPick: (id: string) => void }) {
  const c = useTheme();
  const rows = shown.tests.map((t) => ({ t, r: labResult(t) }));
  const flagged = rows.filter((x) => isFlagged(x.r.flag));
  const trend = (t: LabTest) => {
    const h = labHistory(reports, t).map((p) => ({ ...p, date: shortDate(p.date) }));
    return h.length > 1 ? <Hint>{LABS_TREND(h)}</Hint> : null;
  };
  return (
    <>
      {reports.length > 1 ? (
        <View style={styles.chips}>
          {reports.map((r) => <Chip key={r.id} label={`Show the report from ${r.date}`} text={shortDate(r.date)} pressed={r.id === shown.id} onPress={() => onPick(r.id)} />)}
        </View>
      ) : null}
      <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{LABS_LATEST(shortDate(shown.date))}</Heading>
      {flagged.length ? (
        flagged.map(({ t, r }, i) => (
          <Card key={i} style={r.flag === 'red' ? { borderWidth: 2, borderColor: c.danger } : undefined}>
            <Text style={{ color: c.ink, fontWeight: '700' }}>{`${t.name}: ${t.value} ${t.unit}`}</Text>
            <Text style={{ color: r.flag === 'red' ? c.danger : c.ink, fontWeight: '700' }}>{FLAG_WORD[r.flag]}</Text>
            <Hint>{LABS_RANGE(t.low, t.high, r.flag)}</Hint>
            <Text style={{ color: c.ink }}>{tipText(tipFor(r.flag, r.marker), r.marker)}</Text>
            {r.unitStatus === 'unrecognised' ? <Note>{labs.unit_unrecognised}</Note> : null}
            {trend(t)}
          </Card>
        ))
      ) : (
        <Hint>{labs.all_within_range}</Hint>
      )}
      <AllResults rows={rows} trend={trend} />
    </>
  );
}

function AllResults({ rows, trend }: { rows: { t: LabTest; r: ReturnType<typeof labResult> }[]; trend: (t: LabTest) => React.ReactNode }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label={LABS_ALL(rows.length)} kind="link" expanded={open} onPress={() => setOpen(!open)} />
      {open
        ? rows.map(({ t, r }, i) => (
            <View key={i} style={styles.row}>
              <Text style={{ color: c.ink, flex: 1 }}>{t.name}</Text>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{`${t.value} ${t.unit} · ${FLAG_WORD[r.flag]}`}</Text>
              {r.unitStatus === 'unrecognised' ? <Hint>{labs.unit_unrecognised}</Hint> : null}
              {trend(t)}
            </View>
          ))
        : null}
    </>
  );
}

/** The "Add a lab report" sheet: a date, then a row per test. Errors show beside the row they belong to once Save has been tried. */
function AddForm({ today, onClose, onSave }: { today: string; onClose: () => void; onSave: (r: Omit<LabReport, 'id'>) => Promise<void> }) {
  const c = useTheme();
  const [date, setDate] = useState(today);
  const [tests, setTests] = useState<LabTest[]>([{ ...BLANK }]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const edit = (i: number, k: keyof LabTest, v: string) => setTests(tests.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const report = { date: date.trim(), tests: tests.map((t) => ({ ...t, name: t.name.trim(), value: t.value.trim(), unit: t.unit.trim(), low: t.low.trim(), high: t.high.trim() })) };
  const whole = validateLabReport({ id: '', ...report });
  const dateBad = validateLabReport({ id: '', date: report.date, tests: [] }) === 'bad_date';
  return (
    <SheetModal title={LABS_SHEET_TITLE} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{LABS_SHEET_TITLE}</Heading>
        <Hint>{labs.not_medical_advice}</Hint>
        <Text style={{ color: c.ink, fontWeight: '700' }}>{labs.check_values}</Text>
        <Field label={LABS_DATE_LABEL} placeholder={LABS_DATE_PLACEHOLDER} autoCapitalize="none" autoCorrect={false} value={date} onChangeText={setDate} />
        {tried && dateBad ? <ErrorText>{LAB_ERRORS.bad_date}</ErrorText> : null}
        {tests.map((t, i) => {
          const err = tried ? rowError(report.tests[i] as LabTest) : null;
          return (
            <View key={i} style={styles.test}>
              <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{LABS_TEST_N(i + 1)}</Heading>
              {FIELDS.map((k) => (
                <Field
                  key={k}
                  label={`${LABS_FIELD[k]}, test ${i + 1}`}
                  placeholder={LABS_PLACEHOLDER[k]}
                  value={t[k]}
                  onChangeText={(v) => edit(i, k, v)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  {...(NUMERIC.has(k) ? { inputMode: 'decimal' as const } : {})}
                />
              ))}
              {err ? <ErrorText>{LAB_ERRORS[err]}</ErrorText> : null}
              {tests.length > 1 ? <Button label={LABS_REMOVE_TEST(i + 1)} kind="link" onPress={() => setTests(tests.filter((_, j) => j !== i))} /> : null}
            </View>
          );
        })}
        <Button label={LABS_ADD_TEST} kind="ghost" onPress={() => setTests([...tests, { ...BLANK }])} />
        {tried && (whole === 'no_tests' || whole === 'too_many_tests') ? <ErrorText>{LAB_ERRORS[whole]}</ErrorText> : null}
        <Button
          label={LABS_SAVE}
          busy={busy}
          onPress={() => {
            setTried(true);
            if (whole || busy) return;
            setBusy(true);
            void onSave(report).finally(() => setBusy(false));
          }}
        />
        <Button label={LABS_DISCARD} kind="ghost" onPress={onClose} />
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 24 },
  sheet: { padding: 16, gap: 10 },
  test: { gap: 6, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { gap: 2, paddingVertical: 4 },
});
