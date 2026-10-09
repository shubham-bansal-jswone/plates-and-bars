import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Vibration, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Hint } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

/** The minutes a step asks for ("cook for 12 min"), as the prototype reads them; null when it has none. */
export const stepMinutes = (step: string): number | null => {
  const m = /(\d+)\s*min/.exec(step);
  return m ? Number(m[1]) : null;
};

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Cooking mode (prototype `cookSheet`): one step at a time, large, with a timer for steps that give minutes. */
export function CookMode({ name, steps, onClose, onDone }: { name: string; steps: string[]; onClose: () => void; onDone: () => void }) {
  const c = useTheme();
  const [i, setI] = useState(0);
  // The timer ends at a clock time, so a throttled interval (a backgrounded phone) still shows the right time left.
  const [end, setEnd] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const step = steps[i] ?? '';
  const min = stepMinutes(step);

  useEffect(() => {
    if (end === null) return;
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) {
        setEnd(null);
        setToast('Timer done');
        Vibration.vibrate([300, 150, 300]);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [end]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const go = (d: number) => {
    setEnd(null);
    if (i + d >= steps.length) return onDone();
    setI(Math.max(0, i + d));
  };
  const timer = () => {
    if (end !== null) return setEnd(null);
    setLeft(min! * 60);
    setEnd(Date.now() + min! * 60000);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: c.bg }]}>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22, flex: 1 }}>{name || 'Cooking'}</Text>
            <Button label="×" a11yLabel="Close" kind="link" onPress={onClose} />
          </View>
          <Hint>{`Step ${i + 1} of ${steps.length}`}</Hint>
          <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontSize: 22, lineHeight: 31, fontWeight: '600', paddingVertical: 12 }}>{step}</Text>
          {min !== null ? <Button kind="ghost" label={end !== null ? `${mmss(left)} left, tap to stop` : `Start ${min}-minute timer`} onPress={timer} /> : null}
          <View style={styles.head}>
            {i > 0 ? <Button label="Back" kind="ghost" onPress={() => go(-1)} /> : null}
            <Button label={i >= steps.length - 1 ? 'Done' : 'Next step'} onPress={() => go(1)} />
          </View>
        </ScrollView>
        <ToastBar message={toast} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: 16, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
