import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { getLibrary } from '../src/library/exercises';
import type { Workout } from '../src/workout/types';
import { memoryDb } from './helpers';

// #1122: the library detail adds the exercise to today's stored session (a local write), and can take it out again.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NAME = getLibrary()[0]!.name;
const OTHER = getLibrary()[1]!.name;
const DATE = '2026-10-08';
const now = () => new Date(2026, 9, 8, 10, 0, 0);
type Db = ReturnType<typeof memoryDb>;
const stored = (db: Db) => JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout;
const liveSets = (db: Db, name: string) => [...db.sets.values()].map((s) => JSON.parse(s.data) as { exercise: string; deleted_at: string | null }).filter((s) => s.exercise === name && !s.deleted_at);

async function open(db: Db, name = NAME) {
  await render(<ExerciseLibraryScreen onBack={() => {}} session={{ db, date: DATE, now }} />);
  await fireEvent.press(screen.getByText(name));
}

describe('library: add to today’s session (#1122)', () => {
  it('the button name starts with its visible text (WCAG 2.5.3)', async () => {
    await open(memoryDb());
    const button = await screen.findByLabelText(`Add to today’s session, ${NAME}`);
    expect(button.props.accessibilityLabel.startsWith('Add to today’s session')).toBe(true);
    expect(screen.getByText('Add to today’s session')).toBeTruthy();
  });

  it('has no button without a session target', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByText(NAME));
    expect(screen.queryByLabelText(`Add to today’s session, ${NAME}`)).toBeNull();
  });

  it('with no session yet, starts a hand-picked one with the exercise and its blank sets, saved locally', async () => {
    const db = memoryDb();
    await open(db);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await screen.findByText(`${NAME} added to today’s session.`);
    expect(stored(db).exercises.map((e) => e.name)).toEqual([NAME]);
    expect(stored(db).template).toBeTruthy();
    expect(liveSets(db, NAME).length).toBeGreaterThanOrEqual(3);
  });

  it('adds to a session already built, after its last exercise', async () => {
    const db = memoryDb();
    await open(db, OTHER);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${OTHER}`));
    await screen.findByText(`${OTHER} added to today’s session.`);
    await fireEvent.press(screen.getByLabelText('Back to library'));
    await fireEvent.press(screen.getByText(NAME));
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await waitFor(() => expect(stored(db).exercises.map((e) => e.name)).toEqual([OTHER, NAME]));
  });

  it('shows a disabled already-added state when the exercise is in the session', async () => {
    const db = memoryDb();
    await open(db);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await screen.findByText(`${NAME} added to today’s session.`);
    // Reopening the detail reads the stored session.
    await fireEvent.press(screen.getByLabelText('Back to library'));
    await fireEvent.press(screen.getByText(NAME));
    await screen.findByLabelText(`${NAME} is already in today’s session`);
    expect(stored(db).exercises).toHaveLength(1);
  });

  it('Undo removes the exercise and its sets, and ends the session it started', async () => {
    const db = memoryDb();
    await open(db);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await fireEvent.press(await screen.findByLabelText(`Undo adding ${NAME} to today’s session`));
    await screen.findByLabelText(`Add to today’s session, ${NAME}`);
    await waitFor(() => expect(stored(db).deleted_at).toBeTruthy());
    expect(liveSets(db, NAME)).toHaveLength(0);
  });

  it('Undo keeps the other exercises of the session', async () => {
    const db = memoryDb();
    await open(db, OTHER);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${OTHER}`));
    await screen.findByText(`${OTHER} added to today’s session.`);
    await fireEvent.press(screen.getByLabelText('Back to library'));
    await fireEvent.press(screen.getByText(NAME));
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await fireEvent.press(await screen.findByLabelText(`Undo adding ${NAME} to today’s session`));
    await waitFor(() => expect(stored(db).exercises.map((e) => e.name)).toEqual([OTHER]));
    expect(liveSets(db, OTHER).length).toBeGreaterThan(0);
    expect(liveSets(db, NAME)).toHaveLength(0);
  });

  it('keeps cardio minutes when the session it started is undone', async () => {
    const db = memoryDb();
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ id: null, version: 0, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date: DATE, template: null, base: null, where: null, mods: {}, exercises: [], ci_choice: null, cardio_min: 20 }));
    await open(db);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await screen.findByText(`${NAME} added to today’s session.`);
    expect(stored(db).cardio_min).toBe(20);
    await fireEvent.press(screen.getByLabelText(`Undo adding ${NAME} to today’s session`));
    await waitFor(() => expect(stored(db).exercises).toHaveLength(0));
    expect(stored(db)).toMatchObject({ cardio_min: 20, deleted_at: null, template: null });
  });

  it('works offline: only the local store is touched, and a failed save says so', async () => {
    const db = memoryDb();
    db.failWrites = true;
    await open(db);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await screen.findByText('Couldn’t save that. Try again.');
    expect(db.rows.has(`workouts:${DATE}`)).toBe(false);
  });

  it('a double tap on Add adds once and still shows the added status with Undo', async () => {
    const db = memoryDb();
    await open(db);
    const add = await screen.findByLabelText(`Add to today’s session, ${NAME}`);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    db.hold = () => gate; // the first save stays pending while the second tap lands
    await fireEvent.press(add);
    await fireEvent.press(add);
    db.hold = undefined;
    release();
    await screen.findByText(`${NAME} added to today’s session.`);
    expect(screen.getByLabelText(`Undo adding ${NAME} to today’s session`)).toBeTruthy();
    expect(stored(db).exercises).toHaveLength(1);
  });

  it('a failed Undo keeps Undo available and shows the error, and a retry then works', async () => {
    const db = memoryDb();
    await open(db);
    await fireEvent.press(await screen.findByLabelText(`Add to today’s session, ${NAME}`));
    await screen.findByText(`${NAME} added to today’s session.`);
    db.failWrites = true;
    await fireEvent.press(screen.getByLabelText(`Undo adding ${NAME} to today’s session`));
    await screen.findByText('Couldn’t save that. Try again.');
    expect(screen.getByLabelText(`Undo adding ${NAME} to today’s session`)).toBeTruthy();
    expect(screen.queryByLabelText(`Add to today’s session, ${NAME}`)).toBeNull();
    db.failWrites = false;
    await fireEvent.press(screen.getByLabelText(`Undo adding ${NAME} to today’s session`));
    await screen.findByLabelText(`Add to today’s session, ${NAME}`);
  });
});
