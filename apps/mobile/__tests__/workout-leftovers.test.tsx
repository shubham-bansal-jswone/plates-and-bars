import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Vibration } from 'react-native';
import type { ExInfo } from '@plate-and-bar/core';
import { ExerciseDetail } from '../src/library/ExerciseDetail';
import { getLibrary } from '../src/library/exercises';
import { buzz } from '../src/haptics';
import { rampEasyNote } from '../src/workout/copy';
import { HowToSheet, RestBar } from '../src/workout/parts';
import { getCatalog } from '../src/workout/catalog';

const row = (w: string, rate: 'easy' | 'right' | 'hard' | 'fail' | null, done = true) => ({ w, done, rate });
const info = (type: ExInfo['type'], lo: number, step: number): ExInfo => ({ type, lo, hi: lo + 4, step });

describe('rampEasyNote (#823)', () => {
  it('says what to do next after an Easy ramp set, with the next step as kgLabel words it', () => {
    expect(rampEasyNote([row('20', 'easy')], info('machine', 8, 5))).toBe('Easy, so add a step (about 25 kg) and do another ramp set of 8 reps.');
    expect(rampEasyNote([row('10', 'easy')], info('dumbbell', 8, 2.5))).toBe('Easy, so add a step (about 12.5 kg each) and do another ramp set of 8 reps.');
    // An assisted machine gets easier by taking assistance off, and never below 0.
    expect(rampEasyNote([row('30', 'easy')], info('assisted', 6, 5))).toBe('Easy, so add a step (about 25 kg assist) and do another ramp set of 6 reps.');
    expect(rampEasyNote([row('2.5', 'easy')], info('assisted', 6, 5))).toBe('Easy, so add a step (about 0 kg assist) and do another ramp set of 6 reps.');
  });

  it('uses the last set that is done and rated, and is silent for other ratings or none', () => {
    const m = info('machine', 8, 5);
    expect(rampEasyNote([row('20', 'easy'), row('25', null)], m)).toBe('Easy, so add a step (about 25 kg) and do another ramp set of 8 reps.');
    expect(rampEasyNote([row('20', 'easy'), row('25', 'right')], m)).toBeNull();
    expect(rampEasyNote([row('20', null)], m)).toBeNull();
    expect(rampEasyNote([row('20', 'easy', false)], m)).toBeNull();
    expect(rampEasyNote([], m)).toBeNull();
  });
});

describe('How-to sheet (#823)', () => {
  let open: jest.SpyInstance;
  beforeEach(() => {
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });
  afterEach(() => open.mockRestore());

  it('shows the exercise’s own body map before the written guide, from its content tags', async () => {
    await render(<HowToSheet name="Barbell Bench Press" onClose={() => {}} />);
    const tags = getCatalog().tags['Barbell Bench Press']!;
    const map = await screen.findByRole('image', { name: /^Muscles worked: / });
    expect(map.props.accessibilityLabel).toContain('Muscles worked: chest');
    expect(tags.primary.length).toBeGreaterThan(0);
    expect(screen.getByText('Where you should feel it: ', { exact: false })).toBeTruthy();
  });

  it('has the video link, which opens a YouTube search outside the app and says so in its name', async () => {
    await render(<HowToSheet name="Barbell Bench Press" onClose={() => {}} />);
    const link = await screen.findByRole('link', { name: 'Watch form videos for Barbell Bench Press on YouTube, opens outside the app' });
    expect(screen.getByText('Watch form videos on YouTube ↗')).toBeTruthy();
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Barbell%20Bench%20Press%20proper%20form');
  });

  it('drops a bracketed note from the search, and an exercise with no guide has the link but no map', async () => {
    await render(<HowToSheet name="Plank (seconds)" onClose={() => {}} />);
    await fireEvent.press(await screen.findByRole('link', { name: /^Watch form videos for Plank \(seconds\)/ }));
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Plank%20proper%20form');
    await screen.unmount();
    await render(<HowToSheet name="Some Unknown Lift" onClose={() => {}} />);
    expect(await screen.findByText(/No written guide for this exercise yet/)).toBeTruthy();
    expect(screen.queryByRole('image')).toBeNull();
    expect(screen.getByRole('link', { name: /^Watch form videos for Some Unknown Lift/ })).toBeTruthy();
  });

  it('the library detail has the same map and link', async () => {
    const e = getLibrary().find((x) => x.name === 'Barbell Bench Press')!;
    await render(<ExerciseDetail exercise={e} onBack={() => {}} />);
    expect(screen.getByRole('image', { name: /^Muscles worked: / })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: /^Watch form videos for Barbell Bench Press/ }));
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Barbell%20Bench%20Press%20proper%20form');
  });
});

describe('Vibration (#823)', () => {
  let vibrate: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vibrate.mockRestore();
    jest.useRealTimers();
  });

  it('vibrates [250, 120, 250] once when the rest reaches 0, not while counting, and not again after +30 s', async () => {
    const rest = (end: number) => <RestBar rest={{ id: 1, end, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />;
    const end = Date.now() + 2000;
    const view = await render(rest(end));
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(vibrate).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(screen.getByTestId('rest-title').props.children).toBe('Rest done, go!');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([250, 120, 250]);
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    // "+30 s" after the end: the countdown restarts, and reaching 0 again is the same rest.
    await view.rerender(rest(Date.now() + 30000));
    await act(async () => { jest.advanceTimersByTime(31000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('a new rest buzzes again', async () => {
    const view = await render(<RestBar rest={{ id: 1, end: Date.now() + 500, total: 1, label: 'a' }} onAdd={() => {}} onSkip={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    await view.rerender(<RestBar rest={{ id: 2, end: Date.now() + 500, total: 1, label: 'b' }} onAdd={() => {}} onSkip={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('buzz never throws where vibrating is not supported', () => {
    vibrate.mockImplementation(() => {
      throw new Error('not supported');
    });
    expect(() => buzz(60)).not.toThrow();
  });
});
