import { useState } from 'react';
import { View } from 'react-native';
import importAliases from '../../../../content/import-aliases.json';
import { matchAll, parseWorkoutCsv, planImport, type ImportMatches, type ImportParsed, type ImportSource, type WeightUnit } from '@plate-and-bar/core';
import { Button, Card, Choice, Chip, ErrorText, Group, H1, Hint, Label, Note, Page } from '../components/ui';
import type { PullDb } from '../db/outbox';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { useWeightUnit } from '../settings/weightUnit';
import { useOptionalSettings } from '../state/SettingsProvider';
import { dateWithYear } from '../format';
import { localDate } from '../setup/logic';
import { exerciseNamed, getCatalog } from '../workout/catalog';
import { FALLBACK_TAGS } from '../workout/suggestTags';
import { IMPORT_COPY as t } from './copy';
import { ExercisePicker } from './ExercisePicker';
import { pickCsv } from './pickCsv';
import { occupiedDates, writeImport } from './writeImport';

type Preview = { parsed: ImportParsed; matches: ImportMatches; occupied: Set<string> };
type Summary = { days: number; sets: number; custom: number; leftOut: number; occupied: number };

/**
 * Import of past workouts from a Strong or Hevy CSV (#1179): choose the app (and, for Strong, the unit), pick the file, check the
 * preview, decide each exercise the library does not know, import. Everything runs on the device and nothing waits on the network.
 */
export function ImportWorkouts({ db, onClose }: { db: WorkoutDb & PullDb; onClose: () => void }) {
  const { unit: appUnit } = useWeightUnit();
  const settings = useOptionalSettings();
  const [source, setSource] = useState<ImportSource>('strong');
  const [unit, setUnit] = useState<WeightUnit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [own, setOwn] = useState<Set<string>>(new Set());
  // Imported name to the library exercise the user matched it to.
  const [matchTo, setMatchTo] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const chosenUnit = unit ?? appUnit;

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await pickCsv();
      if (picked.kind === 'cancelled') return;
      if (picked.kind !== 'text') return setError(t.badFile[picked.kind]);
      const r = parseWorkoutCsv(picked.text, source, chosenUnit, localDate(new Date()));
      if (!r.ok) return setError(t.badFile[r.error]);
      const matches = matchAll(r.parsed.days, Object.keys(getCatalog().tags), importAliases.aliases);
      const occupied = await occupiedDates(db, r.parsed.days.map((d) => d.date));
      setOwn(new Set());
      setMatchTo({});
      setPreview({ parsed: r.parsed, matches, occupied });
    } catch {
      setError(t.badFile.unreadable);
    } finally {
      setBusy(false);
    }
  };

  const choice = (name: string, how: 'skip' | 'own') => {
    setMatchTo(({ [name]: _gone, ...rest }) => rest);
    setOwn((cur) => {
      const next = new Set(cur);
      if (how === 'own') next.add(name);
      else next.delete(name);
      return next;
    });
  };

  // What would be written with the choices so far (an exercise to add as one's own counts as kept).
  const mappingFor = (p: Preview): Record<string, string | null> => {
    const m: Record<string, string | null> = { ...p.matches.matched };
    for (const n of p.matches.unmatched) m[n] = matchTo[n] ?? (own.has(n) ? n : null);
    return m;
  };

  const run = async () => {
    if (busy || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const mapping = mappingFor(preview);
      let custom = 0;
      for (const name of preview.matches.unmatched) {
        if (matchTo[name] !== undefined || !own.has(name)) continue;
        // The existing custom-exercise path: saved with the app's no-AI tags. A refused name (a near-duplicate, or the limit) takes the known exercise, else is skipped.
        if (settings && (await settings.addCustomTags(name, FALLBACK_TAGS))) custom++;
        else mapping[name] = exerciseNamed(name) ?? null;
      }
      const plan = planImport(preview.parsed.days, mapping, preview.occupied, newId);
      const w = await writeImport(db, plan);
      setSummary({ days: w.days, sets: w.sets, custom, leftOut: plan.skippedExercise, occupied: plan.occupied.length + w.occupied.length });
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    return (
      <Page>
        <H1>{t.doneTitle}</H1>
        <Card>
          <Note>{t.imported(summary.days, summary.sets)}</Note>
          {summary.custom ? <Hint>{t.addedOwn(summary.custom)}</Hint> : null}
          {summary.leftOut ? <Hint>{t.leftOutExercise(summary.leftOut)}</Hint> : null}
          {summary.occupied ? <Hint>{t.skippedDays(summary.occupied)}</Hint> : null}
          {preview ? <Hint>{t.skipped(preview.parsed.skipped.warmup, preview.parsed.skipped.cardio, preview.parsed.skipped.invalid, preview.parsed.skipped.duplicate, preview.parsed.skipped.tooManyExercises, preview.parsed.skipped.future)}</Hint> : null}
        </Card>
        <Button label={t.done} onPress={onClose} />
      </Page>
    );
  }

  if (preview) {
    const { parsed, matches, occupied } = preview;
    const plan = planImport(parsed.days, mappingFor(preview), occupied);
    const sk = parsed.skipped;
    const left = t.skipped(sk.warmup, sk.cardio, sk.invalid, sk.duplicate, sk.tooManyExercises, sk.future);
    return (
      <Page>
        <H1>{t.previewTitle}</H1>
        <Card>
          <Note>{t.workouts(parsed.days.length, parsed.sets)}</Note>
          {parsed.firstDate && parsed.lastDate ? <Hint>{t.range(dateWithYear(parsed.firstDate), dateWithYear(parsed.lastDate))}</Hint> : null}
          <Hint>{t.unitUsed(parsed.unit)}</Hint>
          <Hint>{t.matched(Object.keys(matches.matched).length)}</Hint>
          {left ? <Hint>{left}</Hint> : null}
          {occupied.size ? (
            <>
              <Hint>{t.occupied(occupied.size)}</Hint>
              <Hint>{t.occupiedDates([...occupied].sort().slice(0, 5).map(dateWithYear).join(', ') + (occupied.size > 5 ? ', …' : ''))}</Hint>
            </>
          ) : null}
        </Card>
        {matches.unmatched.length ? (
          <Card>
            <Label>{t.unmatchedTitle(matches.unmatched.length)}</Label>
            <Hint>{t.unmatchedHint}</Hint>
            {matches.unmatched.map((name) => (
              <View key={name} style={{ gap: 8 }}>
                <Note>{name}</Note>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip label={t.skipLabel(name)} text={t.skip} pressed={matchTo[name] === undefined && !own.has(name)} onPress={() => choice(name, 'skip')} />
                  <Chip label={t.addLabel(name)} text={t.addOwn} pressed={matchTo[name] === undefined && own.has(name)} onPress={() => choice(name, 'own')} />
                  <Chip
                    label={matchTo[name] === undefined ? t.matchLabel(name) : t.matchedToLabel(name, matchTo[name])}
                    text={matchTo[name] === undefined ? t.match : t.matchedTo(matchTo[name])}
                    pressed={matchTo[name] !== undefined}
                    onPress={() => setPicking(name)}
                  />
                </View>
              </View>
            ))}
          </Card>
        ) : null}
        {picking ? (
          <ExercisePicker
            onClose={() => setPicking(null)}
            onPick={(to) => {
              setMatchTo((cur) => ({ ...cur, [picking]: to }));
              setPicking(null);
            }}
          />
        ) : null}
        {plan.sets === 0 ? <Hint>{t.nothing}</Hint> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={{ gap: 12 }}>
          <Button label={busy ? t.importing : t.importBtn} busy={busy} disabled={plan.sets === 0} onPress={() => void run()} />
          <Button kind="ghost" label={t.back} onPress={() => (setPreview(null), setError(null))} />
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <H1>{t.title}</H1>
      <Card>
        <Hint>{t.intro}</Hint>
      </Card>
      <Label>{t.appLabel}</Label>
      <Group label={t.appLabel}>
        <Choice label={t.strong} selected={source === 'strong'} onPress={() => setSource('strong')} />
        <Choice label={t.hevy} selected={source === 'hevy'} onPress={() => setSource('hevy')} />
      </Group>
      {source === 'strong' ? (
        <Group label={t.unitLabel}>
          <Hint>{t.unitLabel}</Hint>
          <Choice label={t.kg} selected={chosenUnit === 'kg'} onPress={() => setUnit('kg')} />
          <Choice label={t.lb} selected={chosenUnit === 'lb'} onPress={() => setUnit('lb')} />
        </Group>
      ) : (
        <Hint>{t.unitHevy}</Hint>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ gap: 12 }}>
        <Button label={busy ? t.reading : t.choose} busy={busy} onPress={() => void choose()} />
        <Button kind="ghost" label={t.cancel} onPress={onClose} />
      </View>
    </Page>
  );
}
