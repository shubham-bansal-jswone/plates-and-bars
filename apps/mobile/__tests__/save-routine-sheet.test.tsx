/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createRoutine, loadRoutines } from '../src/db/routines';
import { SaveRoutineSheet } from '../src/workout/SaveRoutineSheet';
import { ROUTINE_COPY as T } from '../src/workout/copy';
import { openDb } from './sync-helpers';

// "Save as routine" sheet (#1184): the name rules, the 100 cap, and that it works with no network.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const EXS = [{ name: 'Squat', sets: 4 }, { name: 'Bench press', sets: 3 }];
type Db = Awaited<ReturnType<typeof openDb>>;
async function open(db: Db, defaultName = 'Upper A') {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  await render(<SaveRoutineSheet db={db as never} exercises={EXS} defaultName={defaultName} onSaved={onSaved} onClose={onClose} />);
  return { onSaved, onClose };
}
const name = () => screen.getByLabelText(T.nameLabel);
const save = () => fireEvent.press(screen.getByLabelText(T.save));

describe('SaveRoutineSheet', () => {
  it('saves one routine with the exercises and set counts in order, named by the default, and tells the caller', async () => {
    const db = await openDb();
    const { onSaved } = await open(db);
    expect(name().props.value).toBe('Upper A');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Upper A'));
    const all = await loadRoutines(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'Upper A', exercises: [{ name: 'Squat', sets: 4 }, { name: 'Bench press', sets: 3 }] });
  });

  it('saves with no network: nothing is fetched', async () => {
    const db = await openDb();
    const fetchSpy = jest.fn(() => Promise.reject(new Error('offline')));
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    const { onSaved } = await open(db);
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await loadRoutines(db)).toHaveLength(1);
  });

  it.each([['blank', '   '], ['61 characters', 'x'.repeat(61)]])('refuses a %s name with an announced error and writes nothing', async (_n, bad) => {
    const db = await openDb();
    const { onSaved } = await open(db);
    await fireEvent.changeText(name(), bad);
    await save();
    const msg = await screen.findByText(T.nameError(60));
    expect(onSaved).not.toHaveBeenCalled();
    expect(await loadRoutines(db)).toHaveLength(0);
    expect(name().props['aria-describedby']).toBe(msg.props.nativeID);
    expect(name().props['aria-invalid']).toBe(true);
    // Editing clears the message.
    await fireEvent.changeText(name(), 'ok');
    expect(screen.queryByText(T.nameError(60))).toBeNull();
  });

  it('accepts a 60 code point name made of emoji', async () => {
    const db = await openDb();
    const { onSaved } = await open(db);
    await fireEvent.changeText(name(), '💪'.repeat(60));
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('refuses the 101st routine with the cap message and keeps the sheet open', async () => {
    const db = await openDb();
    for (let i = 0; i < 100; i++) await createRoutine(db, `R${i}`, EXS);
    const { onSaved, onClose } = await open(db);
    await save();
    expect(await screen.findByText(T.tooMany(100))).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(await loadRoutines(db)).toHaveLength(100);
  });

  it('two presses in one tick create one routine and call onSaved once', async () => {
    const db = await openDb();
    const { onSaved } = await open(db);
    const b = screen.getByLabelText(T.save);
    await act(async () => {
      void fireEvent.press(b);
      void fireEvent.press(b);
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(await loadRoutines(db)).toHaveLength(1);
  });

  it('is not stuck after a refused name: fixing it saves', async () => {
    const db = await openDb();
    const { onSaved } = await open(db, '');
    await save();
    await screen.findByText(T.nameError(60));
    await fireEvent.changeText(name(), 'Fixed');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Fixed'));
    expect(await loadRoutines(db)).toHaveLength(1);
  });

  it('tells the caller the trimmed name', async () => {
    const db = await openDb();
    const { onSaved } = await open(db);
    await fireEvent.changeText(name(), '  Pull day  ');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Pull day'));
  });

  it('shows the generic failure, not the name message, for a refusal that is not the name', async () => {
    const db = await openDb();
    const onSaved = jest.fn();
    await render(<SaveRoutineSheet db={db as never} exercises={[]} defaultName="A" onSaved={onSaved} onClose={() => {}} />);
    await save();
    expect(await screen.findByText(T.failed)).toBeTruthy();
    expect(screen.queryByText(T.nameError(60))).toBeNull();
    expect(screen.queryByText(T.tooMany(100))).toBeNull();
  });

  it('says so when the session was cut to 50 exercises, and not otherwise', async () => {
    const db = await openDb();
    const view = await render(<SaveRoutineSheet db={db as never} exercises={EXS} defaultName="A" capped onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByText(T.capped(50))).toBeTruthy();
    await view.unmount();
    await open(db);
    expect(screen.queryByText(T.capped(50))).toBeNull();
  });

  it('words the name error by what is allowed, in code points', () => {
    expect(T.nameError(60)).toBe('Give the routine a name, 60 characters or fewer.');
  });

  describe('on the web', () => {
    const g = globalThis as Record<string, unknown>;
    beforeAll(() => {
      const { window } = new JSDOM('<!doctype html><body><button id="opener">Save as routine</button></body>');
      g.document = window.document;
      g.HTMLElement = window.HTMLElement;
    });
    afterAll(() => {
      delete g.document;
      delete g.HTMLElement;
    });
    beforeEach(() => jest.replaceProperty(Platform, 'OS', 'web'));
    afterEach(() => jest.restoreAllMocks());

    it('is a named dialog and gives focus back to the opener on close', async () => {
      const db = await openDb();
      (document.getElementById('opener') as HTMLElement).focus();
      const view = await render(<SaveRoutineSheet db={db as never} exercises={EXS} defaultName="A" onSaved={() => {}} onClose={() => {}} />);
      expect(screen.getByLabelText(T.title, { hidden: true })).toBeTruthy();
      (document.body.appendChild(document.createElement('input')) as HTMLElement).focus(); // focus moved into the dialog
      await view.unmount();
      expect(document.activeElement?.id).toBe('opener');
    });
  });
});
