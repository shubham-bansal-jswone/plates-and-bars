import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { focusNode } from '../labelscan/focus';
import { Text } from '../components/Text';
import { Button, Card } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * "Complete workout" at the bottom of the session: finish early with the ticked sets. Two steps in the page (no browser dialog):
 * the button, then a question with Confirm / Keep going. The caller hides it with no tick or every set ticked.
 */
export function FinishWorkout({ done, all, onFinish }: { done: number; all: number; onFinish: () => void }) {
  const c = useTheme();
  const [asking, setAsking] = useState(false);
  const button = useRef<ComponentRef<typeof View>>(null);
  const prompt = useRef<ComponentRef<typeof View>>(null);
  const back = useRef(false);
  // Focus follows the swap: to the question when it opens, back to the button when the user keeps going.
  useEffect(() => {
    if (asking) focusNode(prompt.current);
    else if (back.current) focusNode(button.current);
    back.current = false;
  }, [asking]);
  if (!asking) return <Button ref={button} kind="ghost" label="Complete workout" onPress={() => setAsking(true)} />;
  return (
    <Card>
      <View ref={prompt} accessible testID="finish-prompt">
        <Text style={[type.bodyStrong, { color: c.ink }]}>{`Finish with ${done} of ${all} sets?`}</Text>
        <Text style={[type.caption, { color: c.muted }]}>Unticked sets, and exercises you haven’t started with their warm-ups, are removed from today.</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.fill}>
          <Button label="Confirm" onPress={onFinish} />
        </View>
        <View style={styles.fill}>
          <Button
            kind="ghost"
            label="Keep going"
            onPress={() => {
              back.current = true;
              setAsking(false);
            }}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  fill: { flex: 1 },
});
