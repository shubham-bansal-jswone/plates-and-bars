import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform, Vibration } from 'react-native';
import type { ExInfo } from '@plate-and-bar/core';
import { ExerciseDetail } from '../src/library/ExerciseDetail';
import { getLibrary } from '../src/library/exercises';
import * as Haptics from 'expo-haptics';
import { buzz, restDoneBuzz } from '../src/haptics';
import { rampEasyNote } from '../src/workout/copy';
import { HowToSheet, RestBar } from '../src/workout/parts';
import { getCatalog } from '../src/workout/catalog';

// babel-jest hoists this above the imports; it applies to the whole file.
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));

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
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
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
    const link = await screen.findByRole('link', { name: 'Watch form videos on YouTube for Barbell Bench Press, opens outside the app' });
    expect(screen.getByText('Watch form videos on YouTube ↗')).toBeTruthy();
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Barbell%20Bench%20Press%20proper%20form');
  });

  it('drops a bracketed note from the search, and an exercise with no guide has the link but no map', async () => {
    await render(<HowToSheet name="Plank (seconds)" onClose={() => {}} />);
    await fireEvent.press(await screen.findByRole('link', { name: /^Watch form videos on YouTube for Plank \(seconds\)/ }));
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Plank%20proper%20form');
    await screen.unmount();
    await render(<HowToSheet name="Some Unknown Lift" onClose={() => {}} />);
    expect(await screen.findByText(/No written guide for this exercise yet/)).toBeTruthy();
    expect(screen.queryByRole('image')).toBeNull();
    expect(screen.getByRole('link', { name: /^Watch form videos on YouTube for Some Unknown Lift/ })).toBeTruthy();
  });

  it('the library detail has the same map and link', async () => {
    const e = getLibrary().find((x) => x.name === 'Barbell Bench Press')!;
    await render(<ExerciseDetail exercise={e} onBack={() => {}} />);
    expect(screen.getByRole('image', { name: /^Muscles worked: / })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: /^Watch form videos on YouTube for Barbell Bench Press/ }));
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Barbell%20Bench%20Press%20proper%20form');
  });
});

describe('Vibration (#823)', () => {
  let vibrate: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.replaceProperty(Platform, 'OS', 'android'); // jest-expo defaults to iOS, which uses a system haptic (#885)
    vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vibrate.mockRestore();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('vibrates [0, 250, 120, 250] once when the rest reaches 0, not while counting, and again after +30 s, which re-arms it', async () => {
    const rest = (end: number) => <RestBar rest={{ id: 1, end, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />;
    const end = Date.now() + 2000;
    const view = await render(rest(end));
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(vibrate).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(screen.getByTestId('rest-title', { includeHiddenElements: true }).props.children).toBe('Rest done, go!');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([0, 250, 120, 250]);
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    // "+30 s" after the end: the countdown restarts and re-arms the buzz (prototype `REST.buzzed = false`), so it buzzes again at 0.
    await view.rerender(rest(Date.now() + 30000));
    await act(async () => { jest.advanceTimersByTime(29000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(vibrate).toHaveBeenCalledTimes(2);
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('"+30 s" long after the rest ended buzzes at once, because the new end (old end + 30 s) is still in the past', async () => {
    const rest = (end: number) => <RestBar rest={{ id: 1, end, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />;
    const end = Date.now() + 2000;
    const view = await render(rest(end));
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(60000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    // Same as addRest in WorkoutScreen: the new end is the old end + 30 s, which is 30 s or more in the past by now.
    await view.rerender(rest(end + 30000));
    await act(async () => {});
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('a new rest buzzes again', async () => {
    const view = await render(<RestBar rest={{ id: 1, end: Date.now() + 500, total: 1, label: 'a' }} onAdd={() => {}} onSkip={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    await view.rerender(<RestBar rest={{ id: 2, end: Date.now() + 500, total: 1, label: 'b' }} onAdd={() => {}} onSkip={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('the rest pattern starts with a 0 wait on Android so the pauses sit at even positions, and is unchanged on the web', () => {
    const os = Platform.OS;
    try {
      Platform.OS = 'android';
      expect(restDoneBuzz()).toEqual([0, 250, 120, 250]);
      Platform.OS = 'web';
      expect(restDoneBuzz()).toEqual([250, 120, 250]);
    } finally {
      Platform.OS = os;
    }
  });

  it('on iOS a pattern is one system haptic, not Vibration.vibrate, which plays an extra buzz per entry; a number still vibrates (#885)', () => {
    const os = Platform.OS;
    try {
      Platform.OS = 'ios';
      buzz(restDoneBuzz());
      expect(vibrate).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
      buzz(60);
      expect(vibrate).toHaveBeenCalledWith(60);
    } finally {
      Platform.OS = os;
    }
  });

  it('buzz never throws where vibrating is not supported', () => {
    vibrate.mockImplementation(() => {
      throw new Error('not supported');
    });
    expect(() => buzz(60)).not.toThrow();
  });
});
