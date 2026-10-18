import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Text } from '../components/Text';
import { ErrorText, Hint, Label, Press, Switch } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { STEPS_COPY } from './copy';
import { useDeviceSteps } from './DeviceStepsProvider';

/** Targets tab: the phone step counter toggle (off by default). Hidden where the build has no step sensor (web, iOS), which keep manual entry. */
export function DeviceStepsSection() {
  const c = useTheme();
  const steps = useDeviceSteps();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!steps?.supported) return null;

  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await steps.turnOn();
      if (r === 'no-sensor') setProblem(STEPS_COPY.noSensor);
      else if (r === 'denied') setProblem(STEPS_COPY.denied);
    } finally {
      setBusy(false);
    }
  };
  // Our own explanation comes first; the system permission dialog only follows a "Continue".
  const change = (next: boolean) => {
    if (busy) return;
    if (!next) return void steps.turnOff();
    Alert.alert(STEPS_COPY.askTitle, STEPS_COPY.askBody, [
      { text: STEPS_COPY.askCancel, style: 'cancel' },
      { text: STEPS_COPY.askContinue, onPress: () => void turnOn() },
    ]);
  };
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Label>{STEPS_COPY.title}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Switch accessibilityLabel={STEPS_COPY.label} value={steps.on} disabled={busy} onValueChange={change} />
        <Press focusable={false} accessibilityElementsHidden importantForAccessibility="no" onPress={() => change(!steps.on)} style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 16 }}>{STEPS_COPY.label}</Text>
        </Press>
      </View>
      <Hint>{STEPS_COPY.off}</Hint>
      <Hint>{STEPS_COPY.how}</Hint>
      {steps.on && steps.permissionLost ? <Hint>{STEPS_COPY.lost}</Hint> : null}
      {problem ? <ErrorText>{problem}</ErrorText> : null}
    </View>
  );
}
