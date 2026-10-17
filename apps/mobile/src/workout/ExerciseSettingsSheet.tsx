import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { DEFAULT_STEP, noLoad, repWord, type ExInfo, type ExType } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Input } from '../components/Input';
import { a11yState, Button, ErrorText, Heading, Hint, Label, Press } from '../components/ui';
import { SETTINGS_UNREADABLE } from '../progress/copy';
import { useOptionalSettings } from '../state/SettingsProvider';
import { useTheme } from '../theme/useTheme';
import { TYPE_LABEL } from './copy';
import { EQUIPMENT, overrideFromDraft, RANGE_INVALID, STEP_CHOICES, withoutOverride } from './exerciseSettings';
import { Chip } from './parts';

const SAVED = 'Saved for this exercise';
const RESET = 'Back to defaults';
const NOT_STORED = 'Couldn’t save that on this device. Try again.';

/**
 * The gear on an exercise card (prototype `exset`) and its sheet (`openExSettings`): equipment, smallest weight jump and rep
 * range for this exercise. Save writes `exercise_overrides[name]`, Reset to default removes it; the card shows the change at once
 * (it reads the same settings). Nothing shows outside a settings provider.
 */
export function ExerciseSettings({ name, info, notify }: { name: string; info: ExInfo; notify?: (msg: string) => void }) {
  return useOptionalSettings() ? <Gear name={name} info={info} notify={notify} /> : null;
}

function Gear({ name, info, notify }: { name: string; info: ExInfo; notify?: (msg: string) => void }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const { saveFailed } = useOptionalSettings()!;
  // The edit shows at once and is written in the background; if that write then fails, say so (the edit stays on screen and is written with the next save).
  const awaiting = useRef(false);
  useEffect(() => {
    if (saveFailed && awaiting.current) {
      awaiting.current = false;
      notify?.(NOT_STORED);
    }
  }, [saveFailed, notify]);
  return (
    <>
      <Press
        accessibilityRole="button"
        accessibilityLabel={`${name} settings`}
        {...a11yState({ expanded: open })}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        style={styles.gear}
      >
        <Text style={{ color: c.muted, fontSize: 20 }}>⚙</Text>
      </Press>
      {open ? (
        <Sheet
          name={name}
          info={info}
          onClose={(done) => {
            setOpen(false);
            if (done) {
              awaiting.current = true;
              notify?.(done);
            }
          }}
        />
      ) : null}
    </>
  );
}

/** Mounted per opening, so it always starts from the exercise's current type, step and range (prototype `ES.v = { ...info }`). */
function Sheet({ name, info, onClose }: { name: string; info: ExInfo; onClose: (done?: string) => void }) {
  const c = useTheme();
  const { update } = useOptionalSettings()!;
  const [type, setType] = useState<ExType>(info.type);
  const [step, setStep] = useState(info.step);
  const [lo, setLo] = useState(String(info.lo));
  const [hi, setHi] = useState(String(info.hi));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const o = overrideFromDraft({ type, step, lo, hi });
    if (!o) return setError(RANGE_INVALID);
    // The edit is applied to the stored record when it is written. Refused when the stored settings could not be read: the values stay here.
    if (!update((s) => ({ exercise_overrides: { ...s.exercise_overrides, [name]: o } }))) return setError(SETTINGS_UNREADABLE);
    onClose(SAVED);
  };
  const reset = () => {
    if (!update((s) => ({ exercise_overrides: withoutOverride(s.exercise_overrides, name) }))) return setError(SETTINGS_UNREADABLE);
    onClose(RESET);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => onClose()}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
                {name}
              </Heading>
            </View>
            <Button label="Close" a11yLabel={`Close ${name} settings`} kind="link" onPress={() => onClose()} />
          </View>

          <View style={{ gap: 6 }}>
            <Label>Equipment</Label>
            <View style={styles.chips}>
              {EQUIPMENT.map((t) => (
                <Chip
                  key={t}
                  label={`Equipment: ${TYPE_LABEL[t]}`}
                  text={TYPE_LABEL[t]}
                  pressed={type === t}
                  onPress={() => {
                    setType(t);
                    setStep(DEFAULT_STEP[t]); // each type starts at its own default step
                  }}
                />
              ))}
            </View>
          </View>

          {noLoad(type) ? null : (
            <View style={{ gap: 6 }}>
              <Label>Smallest weight jump {type === 'dumbbell' ? '(per dumbbell)' : 'on this equipment'}</Label>
              <View style={styles.chips}>
                {STEP_CHOICES.map((x) => (
                  <Chip key={x} label={`Weight jump ${x} kg`} text={`${x} kg`} pressed={step === x} onPress={() => setStep(x)} />
                ))}
              </View>
              <Hint>Machines differ between gyms. Set this to the real step on your gym’s machine.</Hint>
            </View>
          )}

          <View style={styles.range}>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>Range low ({repWord(type)})</Label>
              <Input accessibilityLabel={`Range low (${repWord(type)})`} inputMode="numeric" value={lo} onChangeText={setLo} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>Range high</Label>
              <Input accessibilityLabel="Range high" inputMode="numeric" value={hi} onChangeText={setHi} />
            </View>
          </View>

          {error ? <ErrorText>{error}</ErrorText> : null}
          <View style={styles.chips}>
            <Button label="Save" a11yLabel={`Save settings for ${name}`} onPress={save} />
            <Button label="Reset to default" a11yLabel={`Reset ${name} to default`} kind="ghost" onPress={reset} />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  range: { flexDirection: 'row', gap: 12 },
});
