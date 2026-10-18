import { checkCamera, requestCamera } from '../src/barcode/permission';

// On the web react-native's PermissionsAndroid has no PERMISSIONS table. The web e2e suite found it on PR #1004: the Add sheet imports the
// scanner flow, the permission module threw when it loaded, and the whole web app failed to start. Loading it must not read the table.
jest.mock('react-native', () => ({ Platform: { OS: 'web' }, PermissionsAndroid: {} }));

it('loads and answers on the web without PermissionsAndroid.PERMISSIONS', async () => {
  expect(await checkCamera()).toBe('unavailable');
  expect(await requestCamera()).toBe('unavailable');
});
