import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as loader from '../src/content/loader';
import { widgetTaskHandler } from '../src/widget/handler';
import { HomeWidgetSync } from '../src/widget/HomeWidgetSync';
import { enqueueDay } from '../src/workout/dayQueue';
import { memoryDb } from './helpers';

const mockClose = jest.fn(() => Promise.resolve());
const mockDb = { current: undefined as unknown };
jest.mock('react-native-android-widget', () => ({ registerWidgetTaskHandler: jest.fn(), FlexWidget: 'FlexWidget', TextWidget: 'TextWidget' }));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: () => Promise.resolve({ ...(mockDb.current as object), closeAsync: mockClose }),
  useSQLiteContext: () => mockDb.current,
}));
const mockRefresh = jest.fn();
jest.mock('../src/widget/refresh', () => ({ refreshHomeWidget: (...a: unknown[]) => mockRefresh(...a) }));

const props = (widgetAction: string) => ({ widgetAction, renderWidget: jest.fn(), widgetInfo: {} }) as never;

describe('widgetTaskHandler', () => {
  beforeEach(() => mockClose.mockClear());
  it('does nothing on a tap or a delete', async () => {
    const p = props('WIDGET_CLICK') as { renderWidget: jest.Mock };
    await widgetTaskHandler(p as never);
    await widgetTaskHandler(props('WIDGET_DELETED'));
    expect(p.renderWidget).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
  it('closes the database and keeps what the widget shows when the read fails', async () => {
    const db = memoryDb();
    db.getFirstAsync = () => Promise.reject(new Error('locked'));
    mockDb.current = db;
    const p = props('WIDGET_UPDATE') as { renderWidget: jest.Mock };
    await widgetTaskHandler(p as never);
    expect(p.renderWidget).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
  it('draws and closes the database when it reads (no profile is the open-the-app state)', async () => {
    mockDb.current = memoryDb();
    const p = props('WIDGET_ADDED') as { renderWidget: jest.Mock };
    await widgetTaskHandler(p as never);
    expect(p.renderWidget).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
  it('loads content only when this runtime has none yet (an open app keeps its catalogue)', async () => {
    const load = jest.spyOn(loader, 'loadContent').mockResolvedValue(undefined as never);
    const gen = jest.spyOn(loader, 'contentGeneration');
    try {
      mockDb.current = memoryDb();
      gen.mockReturnValue(0);
      await widgetTaskHandler(props('WIDGET_UPDATE') as never);
      expect(load).toHaveBeenCalledTimes(1);
      gen.mockReturnValue(3);
      await widgetTaskHandler(props('WIDGET_UPDATE') as never);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      load.mockRestore();
      gen.mockRestore();
    }
  });
});

describe('HomeWidgetSync', () => {
  const OLD = process.env.EXPO_PUBLIC_HOME_WIDGET;
  afterEach(() => {
    process.env.EXPO_PUBLIC_HOME_WIDGET = OLD;
    jest.restoreAllMocks();
    jest.useRealTimers();
    mockRefresh.mockClear();
  });
  it('does nothing with the flag off', async () => {
    delete process.env.EXPO_PUBLIC_HOME_WIDGET;
    mockDb.current = memoryDb();
    await render(<HomeWidgetSync />);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
  it('refreshes at start and after a workout write, and stops listening on unmount', async () => {
    process.env.EXPO_PUBLIC_HOME_WIDGET = '1';
    jest.replaceProperty(require('react-native').Platform, 'OS', 'android'); // eslint-disable-line @typescript-eslint/no-require-imports
    jest.useFakeTimers();
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
    mockDb.current = memoryDb();
    const view = await render(<HomeWidgetSync />);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await enqueueDay(async () => undefined, () => undefined);
    jest.advanceTimersByTime(2000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    await enqueueDay(async () => undefined, () => undefined);
    jest.advanceTimersByTime(2000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
