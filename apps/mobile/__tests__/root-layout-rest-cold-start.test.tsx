import { act, render } from '@testing-library/react-native';
import RootLayout from '../app/_layout';

// The root layout with everything around the cold-start take stubbed: only that the app root runs it is under test (#1068).
const mockTake = jest.fn();
jest.mock('../src/reminders/native', () => ({ __esModule: true, default: { takeRest: (...a: unknown[]) => mockTake(...a) } }));
jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-sqlite', () => ({ SQLiteProvider: ({ children }: { children: unknown }) => children, useSQLiteContext: () => ({}) }));
jest.mock('../src/db/migrations', () => ({ DB_NAME: 'x' }));
jest.mock('../src/db/initDb', () => ({ initDb: () => undefined }));
jest.mock('../src/db/lockedDb', () => ({ lockedDb: (d: unknown) => d }));
jest.mock('../src/content/ContentRefresher', () => ({ ContentRefresher: () => null }));
jest.mock('../src/state/Gate', () => ({ Gate: () => null }));
jest.mock('../src/theme/fonts', () => ({ FontsProvider: ({ children }: { children: unknown }) => children }));
jest.mock('../src/sync/db', () => ({ syncDb: (d: unknown) => d }));
jest.mock('../src/sync/SyncBadge', () => ({ SyncBadge: () => null }));
jest.mock('../src/sync/Stores', () => ({ Stores: ({ children }: { children: unknown }) => children }));
jest.mock('../src/sync/SyncProvider', () => ({ SyncProvider: ({ children }: { children: unknown }) => children }));
jest.mock('../src/steps/DeviceStepsProvider', () => ({ DeviceStepsProvider: ({ children }: { children: unknown }) => children }));
jest.mock('../src/telemetry/errors', () => ({ initErrorTracking: () => undefined }));
jest.mock('../src/web/registerServiceWorker', () => ({ registerServiceWorker: () => undefined }));

it('the app root takes down a rest notification left from before the process died, whichever tab opens', async () => {
  mockTake.mockResolvedValue(null);
  await render(<RootLayout />);
  await act(async () => {});
  expect(mockTake).toHaveBeenCalledTimes(1);
});
