import { useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Platform, View } from 'react-native';
import type { PlanProfile } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Caption, Choice, ErrorText, Field, Hint, Label, Press, Switch } from '../components/ui';
import type { StoreDb } from '../db/records';
import { useTheme } from '../theme/useTheme';
import { LABELS, SECTION } from './copy';
import native from './native';
import { WATER_EVERY, clock, movedByQuiet, parseClock, type FixedId, type ReminderPrefs } from './schedule';
import { useReminders } from './useReminders';

/**
 * A time box for the number pad. What is typed is read when the box is left (or submitted): "0815", "815", "8.15" and "8:15" all
 * become "08:15". Nothing is saved while typing, so "8" on the way to "815" is never taken for a time.
 */
function TimeField({ label, value, onValid }: { label: string; value: string; onValid: (t: string) => void }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const r = parseClock(text);
    if (r.ok) {
      setError(null);
      setText(r.time);
      if (r.time !== value) onValid(r.time);
    } else setError(r.error);
  };
  return (
    <View style={{ gap: 4 }}>
      <Field
        label={label}
        value={text}
        placeholder="HH:MM"
        inputMode="numeric"
        maxLength={5}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

function Row({ label, on, onChange, children }: { label: string; on: boolean; onChange: (on: boolean) => void; children?: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Switch accessibilityLabel={label} value={on} onValueChange={onChange} />
        {/* The text toggles the switch too; the switch carries the spoken name. */}
        <Press focusable={false} accessibilityElementsHidden importantForAccessibility="no" onPress={() => onChange(!on)} style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 16 }}>{label}</Text>
        </Press>
      </View>
      {on ? children : null}
    </View>
  );
}

/** Targets tab, "Reminders" (#943): local notifications, device-only, all off by default. Not offered on the web. */
export function RemindersSection({ db, profile }: { db: StoreDb; profile: PlanProfile | null | undefined }) {
  const { ready, prefs, denied, systemOff, saveFailed, change, recheck } = useReminders(db, profile);
  // The phone's notification setting can change while the app is away: ask again each time the tab is shown.
  useFocusEffect(recheck);
  if (Platform.OS === 'web') return null;
  if (!native) {
    return (
      <View style={{ gap: 8, marginTop: 16 }}>
        <Label>{SECTION.title}</Label>
        <Hint>{SECTION.unavailable}</Hint>
      </View>
    );
  }
  if (!ready) return null;
  const fixed = (id: FixedId) => (
    <Row key={id} label={LABELS[id]} on={prefs[id].on} onChange={(on) => change({ ...prefs, [id]: { ...prefs[id], on } })}>
      <Caption>Time</Caption>
      <TimeField label={`${LABELS[id]} time`} value={prefs[id].time} onValid={(time) => change({ ...prefs, [id]: { ...prefs[id], time } })} />
      {id === 'workout' && profile?.days === 0 ? <Hint>Your plan has no training days, so nothing is set.</Hint> : null}
      {id === 'workout' && profile?.days !== 0 ? <Hint>On the days your plan trains.</Hint> : null}
      {movedByQuiet(prefs, id) ? <Hint>{`Goes off at ${prefs.quiet.to}, when quiet hours end.`}</Hint> : null}
    </Row>
  );
  const setQuiet = (k: keyof ReminderPrefs['quiet']) => (t: string) => change({ ...prefs, quiet: { ...prefs.quiet, [k]: t } });
  return (
    <View style={{ gap: 12, marginTop: 16 }}>
      <Label>{SECTION.title}</Label>
      <Hint>{SECTION.intro}</Hint>
      {fixed('weigh_in')}
      {fixed('workout')}
      {fixed('lunch')}
      {fixed('dinner')}
      <Row label={LABELS.water} on={prefs.water.on} onChange={(on) => change({ ...prefs, water: { ...prefs.water, on } })}>
        <Hint>{`Every ${prefs.water.every_h} hours, from ${clock(9 * 60)}, while you are awake.`}</Hint>
        <View accessibilityRole="radiogroup" accessibilityLabel="Water reminder every" style={{ flexDirection: 'row', gap: 8 }}>
          {WATER_EVERY.map((h) => (
            <Choice key={h} chip label={`${h} h`} selected={prefs.water.every_h === h} onPress={() => change({ ...prefs, water: { ...prefs.water, every_h: h } })} />
          ))}
        </View>
      </Row>
      <Row label={LABELS.rest} on={prefs.rest.on} onChange={(on) => change({ ...prefs, rest: { on } })}>
        <Hint>{SECTION.restHint}</Hint>
      </Row>
      <View style={{ gap: 8 }}>
        <Label>Quiet hours</Label>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Caption>From</Caption>
            <TimeField label="Quiet hours from" value={prefs.quiet.from} onValid={setQuiet('from')} />
          </View>
          <View style={{ flex: 1 }}>
            <Caption>Until</Caption>
            <TimeField label="Quiet hours until" value={prefs.quiet.to} onValid={setQuiet('to')} />
          </View>
        </View>
        <Hint>{SECTION.quietHint}</Hint>
      </View>
      {denied || systemOff ? <ErrorText>{SECTION.denied}</ErrorText> : null}
      {saveFailed ? <ErrorText>{SECTION.saveFailed}</ErrorText> : null}
    </View>
  );
}
