import { AccessibilityInfo, Platform } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { DateAnnouncer } from '../src/components/DateBar';
import type { ViewedDate } from '../src/state/ViewedDate';

// Which screens are focused is set per test; each screen reads its own name from a context.
jest.mock('expo-router', () => {
  const react = jest.requireActual('react');
  const Screen = react.createContext('');
  return {
    __Screen: Screen,
    __focused: new Set<string>(),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const name = react.useContext(Screen);
      const { __focused } = jest.requireMock('expo-router');
      react.useEffect(() => (__focused.has(name) ? cb() : undefined), []);
    },
  };
});

const { __Screen: Screen, __focused: focused } = jest.requireMock('expo-router') as { __Screen: React.Context<string>; __focused: Set<string> };

const day = (date: string): ViewedDate => ({ date, today: '2026-10-08', isToday: date === '2026-10-08', prev: () => {}, next: () => {} }) as ViewedDate;
const TABS = ['food', 'workout', 'progress'];
const tabs = (date: string) => (
  <>
    {TABS.map((t) => (
      <Screen.Provider key={t} value={t}>
        <DateAnnouncer v={day(date)} />
      </Screen.Provider>
    ))}
  </>
);

describe('announcing the day on iOS with every tab mounted', () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
    focused.clear();
  });

  it('says a day change once, from the focused screen only', async () => {
    Platform.OS = 'ios';
    focused.add('workout');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    announce.mockClear();
    const ui = await render(tabs('2026-10-08'));
    expect(announce).not.toHaveBeenCalled();
    await act(async () => ui.rerender(tabs('2026-10-07')));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Yesterday, Wednesday, 7 Oct');
    expect(screen.getAllByTestId('date-announce')).toHaveLength(3);
    announce.mockRestore();
  });
});
