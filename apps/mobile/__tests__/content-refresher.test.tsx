import { renderHook } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import { ContentRefresher, CONTENT_REFRESH_INTERVAL_MS } from '../src/content/ContentRefresher';
import { refreshContent } from '../src/content/refresh';

const mockDb = { runAsync: jest.fn(), execAsync: jest.fn(), getFirstAsync: jest.fn(), getAllAsync: jest.fn() };
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('../src/sync/auth', () => ({ API_URL: 'https://example.test/api/v1' }));
jest.mock('../src/content/refresh', () => ({ refreshContent: jest.fn(async () => 0) }));
jest.mock('@plate-and-bar/api', () => ({ createClient: jest.fn(() => ({})) }));

const mount = async () => renderHook(() => ContentRefresher());

describe('ContentRefresher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('refreshes at launch, then once a day, and stops on unmount', async () => {
    const { unmount } = await mount();
    expect(refreshContent).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(CONTENT_REFRESH_INTERVAL_MS - 1);
    expect(refreshContent).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(refreshContent).toHaveBeenCalledTimes(2);
    await unmount();
    jest.advanceTimersByTime(CONTENT_REFRESH_INTERVAL_MS * 3);
    expect(refreshContent).toHaveBeenCalledTimes(2);
  });

  it('uses a client with no token and writes through the database write lock', async () => {
    await mount();
    const [url, getToken] = (createClient as jest.Mock).mock.calls[0];
    expect(url).toBe('https://example.test/api/v1');
    expect(getToken()).toBeNull();
    const { db } = (refreshContent as jest.Mock).mock.calls[0][0];
    expect(db).not.toBe(mockDb); // the locked wrapper, not the raw database
    mockDb.runAsync.mockResolvedValue(undefined);
    await db.runAsync('SELECT 1');
    expect(mockDb.runAsync).toHaveBeenCalledWith('SELECT 1');
  });
});
