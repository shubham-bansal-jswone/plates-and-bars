import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CookMode } from '../src/recipes/CookMode';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));

const os = (name: string) => jest.replaceProperty(Platform, 'OS', name as 'android');

/** Runs a one-minute timer to its end and returns what the phone was asked to do. */
async function finishTimer(): Promise<jest.SpyInstance> {
  const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  await render(<CookMode name="Soup" steps={['Simmer for 1 minute.']} onClose={() => {}} onDone={() => {}} />);
  await fireEvent.press(screen.getByLabelText('Start 1-minute timer'));
  await act(async () => {
    jest.advanceTimersByTime(61000);
  });
  return vibrate;
}

describe('Cook mode timer vibration (#873)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('on Android the pattern starts with a 0 delay, so there are two pulses, not a wait first', async () => {
    os('android');
    expect(await finishTimer()).toHaveBeenCalledWith([0, 300, 150, 300]);
  });

  it('on web the pattern is on, off, on', async () => {
    os('web');
    expect(await finishTimer()).toHaveBeenCalledWith([300, 150, 300]);
  });

  it('on iOS it plays one system haptic and never the pattern, which iOS would play as three buzzes (#885)', async () => {
    os('ios');
    const vibrate = await finishTimer();
    expect(vibrate).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });
});
