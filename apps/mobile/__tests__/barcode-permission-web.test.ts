import { checkCamera, requestCamera } from '../src/barcode/permission';

// On the web react-native's PermissionsAndroid has no PERMISSIONS table. The web e2e suite found it on PR #1004: the Add sheet imports the
// scanner flow, the permission module threw when it loaded, and the whole web app failed to start. Loading it must not read the table.
jest.mock('react-native', () => ({ Platform: { OS: 'web' }, PermissionsAndroid: {} }));

const nav = globalThis as unknown as { navigator?: unknown };
const withNavigator = async (value: unknown, run: () => Promise<void>) => {
  const saved = nav.navigator;
  nav.navigator = value;
  try {
    await run();
  } finally {
    nav.navigator = saved;
  }
};

it('loads and answers on the web without PermissionsAndroid.PERMISSIONS (no camera API: unavailable)', async () => {
  await withNavigator({}, async () => {
    expect(await checkCamera()).toBe('unavailable');
    expect(await requestCamera()).toBe('unavailable');
  });
});

it('a browser with a camera API is granted (it asks when the camera opens)', async () => {
  await withNavigator({ mediaDevices: { getUserMedia: jest.fn() } }, async () => {
    expect(await checkCamera()).toBe('granted');
    expect(await requestCamera()).toBe('granted');
  });
});
