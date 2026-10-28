/** @jest-environment node */
import appJson from '../app.json';
import pkg from '../package.json';

// The widget is declared at prebuild only with EXPO_PUBLIC_HOME_WIDGET=1; the library's plugin writes the manifest receiver and
// the provider XML (checked with a real `expo prebuild`, see the PR). Here the library plugin is replaced to see whether it is called.
const mockLibPlugin = jest.fn((config: unknown, _params: unknown) => ({ ...(config as object), widgetsAdded: true }));
jest.mock('react-native-android-widget/app.plugin', () => ({ __esModule: true, default: (c: unknown, p: unknown) => mockLibPlugin(c, p) }));
/* eslint-disable @typescript-eslint/no-require-imports */
const withHomeWidget = require('../plugins/with-home-widget') as ((c: unknown, env?: Record<string, string | undefined>) => unknown) & {
  WIDGET_NAME: string;
  UPDATE_PERIOD_MS: number;
  widgets: { name: string; updatePeriodMillis: number; widgetCategory: string; minWidth: string; minHeight: string }[];
};

beforeEach(() => mockLibPlugin.mockClear());

describe('home widget config plugin', () => {
  it('is registered in app.json and the library is pinned', () => {
    expect(JSON.stringify(appJson.expo.plugins)).toContain('./plugins/with-home-widget');
    expect(pkg.dependencies['react-native-android-widget']).toBe('0.25.0');
  });
  it('adds nothing with the flag off or unset', () => {
    const config = { name: 'x' };
    expect(withHomeWidget(config, {})).toBe(config);
    expect(withHomeWidget(config, { EXPO_PUBLIC_HOME_WIDGET: '0' })).toBe(config);
    expect(mockLibPlugin).not.toHaveBeenCalled();
  });
  it('declares one 4x2 widget with the flag on, updating every 30 minutes and kept off the lock screen', () => {
    expect(withHomeWidget({ name: 'x' }, { EXPO_PUBLIC_HOME_WIDGET: '1' })).toEqual({ name: 'x', widgetsAdded: true });
    expect(mockLibPlugin).toHaveBeenCalledTimes(1);
    const params = mockLibPlugin.mock.calls[0]?.[1] as { widgets: typeof withHomeWidget.widgets };
    expect(params.widgets).toHaveLength(1);
    expect(params.widgets[0]).toMatchObject({ name: 'TodayWorkout', updatePeriodMillis: 1800000, widgetCategory: 'not_keyguard', targetCellWidth: 4, targetCellHeight: 2 });
  });
});
