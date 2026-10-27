import { View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Card, H1, Hint, Label, Page } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BodyMap } from '../workout/BodyMap';
import { exerciseMotionEnabled } from '../motion/flag';
import { getMotion } from '../motion/data';
import { ExerciseFigure, hasFigure } from '../workout/ExerciseFigure';
import { VideoLink } from '../workout/VideoLink';
import { equipmentLabel, jointLabel, muscleLabel, typeLabel, type LibraryExercise } from './exercises';

const list = (xs: readonly string[]) => (xs.length ? xs.join(', ') : 'None');

/** Setup is numbered; cues and mistakes are bullets; a single note is plain text (the prototype's how-to sheet). */
function Section({ title, items, numbered = false }: { title: string; items: readonly string[]; numbered?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Label>{title}</Label>
      {items.map((s, i) => (
        <Text key={s} style={[type.textBody, { color: c.body }]}>{items.length === 1 ? s : `${numbered ? `${i + 1}.` : '\u2022'} ${s}`}</Text>
      ))}
    </View>
  );
}

function NoDrawing() {
  const c = useTheme();
  return (
    <View testID="no-drawing" accessible accessibilityLabel="No drawing for this exercise yet" style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: 16, backgroundColor: c.surface, padding: 16, minHeight: 96, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.textBody, { color: c.body }]}>No drawing for this exercise yet</Text>
    </View>
  );
}

/** One exercise: name, its start and end drawing, muscle map, tags and the how-to notes. */
export function ExerciseDetail({ exercise: e, onBack }: { exercise: LibraryExercise; onBack: () => void }) {
  const c = useTheme();
  const card = e.card;
  const row = (k: string, v: string) => (
    <Text style={[type.textBody, { color: c.body }]}>
      <Text style={[type.bodyStrong, { color: c.ink }]}>{`${k}: `}</Text>
      {v}
    </Text>
  );
  return (
    <Page>
      <Button label="Back to library" kind="link" onPress={onBack} />
      <H1>{e.name}</H1>
      {hasFigure(e.name) || (exerciseMotionEnabled() && getMotion(e.name)) ? <ExerciseFigure name={e.name} /> : <NoDrawing />}
      {e.primary.length ? <BodyMap primary={e.primary} secondary={e.secondary} /> : null}
      <Card accessibilityLabel="Tags">
        {row('Equipment', equipmentLabel(e.equipment))}
        {row('Type', typeLabel(e.type))}
        {row('Movement', e.movement)}
        {row('Main muscles', list(e.primary.map(muscleLabel)))}
        {row('Helper muscles', list(e.secondary.map(muscleLabel)))}
        {row('Joints', list(e.joints.map(jointLabel)))}
        {row('Difficulty', `${e.difficulty} of 3`)}
        {e.repLow > 0 ? row('Rep range', `${e.repLow} to ${e.repHigh}`) : null}
      </Card>
      {card ? (
        <>
          <View style={{ gap: 4 }}>
            <Label>Where you should feel it</Label>
            <Text style={[type.textBody, { color: c.body }]}>{card.where_to_feel}</Text>
          </View>
          <Section title="Setup" items={card.setup} numbered />
          <Section title="Key cues" items={card.key_cues} />
          <Section title="Common mistakes" items={card.common_mistakes} />
          {card.breathing ? <Section title="Breathing" items={[card.breathing]} /> : null}
          {card.easier_version ? <Section title="Easier version" items={[card.easier_version]} /> : null}
          {card.harder_version ? <Section title="Harder version" items={[card.harder_version]} /> : null}
        </>
      ) : (
        <Hint>No notes for this exercise yet.</Hint>
      )}
      <VideoLink name={e.name} />
    </Page>
  );
}
