import { checkCamera, requestCamera } from '../src/barcode/permission';

// On the web react-native's PermissionsAndroid has no PERMISSIONS table. The web e2e suite found it on PR #1004: the Add sheet imports the
// scanner flow, the permission module threw when it loaded, and the whole web app failed to start. Loading it must not read the table.
jest.mock('react-native', () => ({ Platform: { OS: 'web' }, PermissionsAndroid: {} }));

it('loads and answers on the web without PermissionsAndroid.PERMISSIONS: a browser with a camera API is granted (it asks when the camera opens)', async () => {
  const g = globalThis as unknown as { navigator?: unknown };
  const saved = g.navigator;
  g.navigator = { mediaDevices: { getUserMedia: jest.fn() } };
  try {
    expect(await checkCamera()).toBe('granted');
    expect(await requestCamera()).toBe('granted');
  } finally {
    g.navigator = saved;
  }
});
