import { WIDGET_NAME as PLUGIN_NAME } from '../plugins/with-home-widget';
import { homeWidgetEnabled, WIDGET_NAME } from '../src/widget/flag';
import { onDayWritten, enqueueDay } from '../src/workout/dayQueue';
import { refreshHomeWidget } from '../src/widget/refresh';
import { Platform } from 'react-native';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb } from './helpers';

const mockRequestUpdate = jest.fn();
jest.mock('react-native-android-widget', () => ({
  requestWidgetUpdate: (...a: unknown[]) => mockRequestUpdate(...a),
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
}));

describe('home widget flag', () => {
  it('is off by default, and on only with EXPO_PUBLIC_HOME_WIDGET=1 on Android', () => {
    expect(homeWidgetEnabled(undefined, 'android')).toBe(false);
    expect(homeWidgetEnabled('0', 'android')).toBe(false);
    expect(homeWidgetEnabled('true', 'android')).toBe(false);
    expect(homeWidgetEnabled('1', 'android')).toBe(true);
    expect(homeWidgetEnabled('1', 'ios')).toBe(false);
    expect(homeWidgetEnabled('1', 'web')).toBe(false);
  });
  it('the runtime and the config plugin name the same widget', () => {
    expect(WIDGET_NAME).toBe(PLUGIN_NAME);
  });
});

describe('refreshHomeWidget', () => {
  const OLD = process.env.EXPO_PUBLIC_HOME_WIDGET;
  afterEach(() => {
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_HOME_WIDGET = OLD;
    mockRequestUpdate.mockReset();
  });
  it('does nothing with the flag off', async () => {
    delete process.env.EXPO_PUBLIC_HOME_WIDGET;
    await refreshHomeWidget(memoryDb());
    expect(mockRequestUpdate).not.toHaveBeenCalled();
  });
  it('does nothing off Android, even with the flag on', async () => {
    process.env.EXPO_PUBLIC_HOME_WIDGET = '1';
    await refreshHomeWidget(memoryDb());
    expect(mockRequestUpdate).not.toHaveBeenCalled();
  });
  it('asks the library to redraw the widget by name, from SQLite, on Android with the flag on', async () => {
    process.env.EXPO_PUBLIC_HOME_WIDGET = '1';
    jest.replaceProperty(Platform, 'OS', 'android');
    const db = memoryDb();
    await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
    await refreshHomeWidget(db, new Date(2026, 9, 11, 9, 0));
    expect(mockRequestUpdate).toHaveBeenCalledTimes(1);
    const call = mockRequestUpdate.mock.calls[0]?.[0] as { widgetName: string; renderWidget: () => { light: unknown; dark: unknown } };
    expect(call.widgetName).toBe('TodayWorkout');
    expect(Object.keys(call.renderWidget())).toEqual(['light', 'dark']);
  });
});

describe('onDayWritten', () => {
  it('fires after a queued write, also a failed one, and a throwing listener does not break the queue', async () => {
    const seen = jest.fn();
    const off = onDayWritten(seen);
    const bad = onDayWritten(() => {
      throw new Error('x');
    });
    await enqueueDay(async () => undefined, () => undefined);
    await enqueueDay(() => Promise.reject(new Error('fail')), () => undefined);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    bad();
    await enqueueDay(async () => undefined, () => undefined);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
