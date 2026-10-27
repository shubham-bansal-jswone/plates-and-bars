import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Card, H1, Heading, Hint, Page } from '../components/ui';
import type { PullDb } from '../db/outbox';
import type { WorkoutDb } from '../db/workouts';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BodyMap } from '../workout/BodyMap';
import { ExerciseFigure, hasDrawing } from '../workout/ExerciseFigure';
import { addToStoredDay, inStoredDay, removeFromStoredDay } from '../workout/storedDay';
import { VideoLink } from '../workout/VideoLink';
import { equipmentLabel, jointLabel, muscleLabel, typeLabel, type LibraryExercise } from './exercises';

const list = (xs: readonly string[]) => (xs.length ? xs.join(', ') : 'None');

/** Setup is numbered (even one step), cues and mistakes are bullets, the other notes are plain text (the prototype's openHowTo). */
function Section({ title, items, kind }: { title: string; items: readonly string[]; kind: 'numbered' | 'bullet' | 'plain' }) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Heading level={2} style={[type.label, { color: c.ink }]}>{title}</Heading>
      {items.map((s, i) => (
        <Text key={s} style={[type.textBody, { color: c.body }]}>{kind === 'plain' ? s : `${kind === 'numbered' ? `${i + 1}.` : '\u2022'} ${s}`}</Text>
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

/** Where today's session is stored: when given, the detail can add the exercise to it. */
export interface SessionTarget {
  db: WorkoutDb & PullDb;
  date: string;
  now: () => Date;
}

/**
 * "Add to today's session", offline (a local write). Already in the session: a disabled, labelled state. Just added: a
 * polite status with Undo, which removes it again. With no session yet it starts a hand-picked one (as picking on Start does).
 */
function AddToSession({ name, session }: { name: string; session: SessionTarget }) {
  const c = useTheme();
  const { db, date, now } = session;
  const [state, setState] = useState<'unknown' | 'out' | 'in' | 'just'>('unknown');
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    inStoredDay(db, date, name).then((i) => live && setState(i ? 'in' : 'out'), () => live && setState('out'));
    return () => {
      live = false;
    };
  }, [db, date, name]);
  const onError = () => setError(true);
  const add = async () => {
    setError(false);
    const r = await addToStoredDay({ db, date, now, name, onError });
    if (r === 'added') setState('just');
    else if (r === 'already') setState('in');
  };
  const undo = () => {
    setError(false);
    setState('out');
    void removeFromStoredDay({ db, date, now, name, onError });
  };
  if (state === 'unknown') return null;
  return (
    <View style={{ gap: 4 }}>
      {state === 'just' ? (
        <>
          <Text accessibilityLiveRegion="polite" style={[type.textBody, { color: c.body }]}>{`${name} added to today’s session.`}</Text>
          <Button label="Undo" a11yLabel={`Undo adding ${name} to today’s session`} kind="ghost" onPress={undo} />
        </>
      ) : (
        <Button
          label={state === 'in' ? 'In today’s session' : 'Add to today’s session'}
          a11yLabel={state === 'in' ? `${name} is already in today’s session` : `Add ${name} to today’s session`}
          kind="ghost"
          disabled={state === 'in'}
          onPress={() => void add()}
        />
      )}
      {error ? <Text accessibilityRole="alert" style={[type.textBody, { color: c.body }]}>Couldn’t save that. Try again.</Text> : null}
    </View>
  );
}

/** One exercise: name, its start and end drawing, muscle map, tags and the how-to notes. */
export function ExerciseDetail({ exercise: e, onBack, session }: { exercise: LibraryExercise; onBack: () => void; session?: SessionTarget }) {
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
      {session ? <AddToSession name={e.name} session={session} /> : null}
      {hasDrawing(e.name) ? <ExerciseFigure name={e.name} /> : <NoDrawing />}
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
            <Heading level={2} style={[type.label, { color: c.ink }]}>Where you should feel it</Heading>
            <Text style={[type.textBody, { color: c.body }]}>{card.where_to_feel}</Text>
          </View>
          <Section title="Setup" items={card.setup} kind="numbered" />
          <Section title="Key cues" items={card.key_cues} kind="bullet" />
          <Section title="Common mistakes" items={card.common_mistakes} kind="bullet" />
          {card.breathing ? <Section title="Breathing" items={[card.breathing]} kind="plain" /> : null}
          {card.easier_version ? <Section title="Easier version" items={[card.easier_version]} kind="plain" /> : null}
          {card.harder_version ? <Section title="Harder version" items={[card.harder_version]} kind="plain" /> : null}
        </>
      ) : (
        <Hint>No notes for this exercise yet.</Hint>
      )}
      <VideoLink name={e.name} />
    </Page>
  );
}
