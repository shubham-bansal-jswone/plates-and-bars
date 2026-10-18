// On the web react-native's PermissionsAndroid has no PERMISSIONS table. Found by the Playwright spec (#944): the module threw when it
// loaded, so the scanner screen crashed in the browser. Loading it must not read the table.
import { checkCamera, requestCamera } from '../src/barcode/permission';

jest.mock('react-native', () => ({ Platform: { OS: 'web' }, PermissionsAndroid: {} }));

it('loads and answers on the web without PermissionsAndroid.PERMISSIONS', async () => {
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
