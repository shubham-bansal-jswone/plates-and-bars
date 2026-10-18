import { PermissionsAndroid, Platform } from 'react-native';
import { checkCamera, requestCamera } from '../src/barcode/permission';
import { BARCODE_COPY } from '../src/barcode/copy';

const setOs = (os: 'android' | 'ios' | 'web') => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
};
afterEach(() => {
  jest.restoreAllMocks();
  setOs('ios');
});

describe('camera permission', () => {
  it('is unavailable off Android and asks nothing', async () => {
    setOs('ios');
    const check = jest.spyOn(PermissionsAndroid, 'check');
    const request = jest.spyOn(PermissionsAndroid, 'request');
    expect(await checkCamera()).toBe('unavailable');
    expect(await requestCamera()).toBe('unavailable');
    expect(check).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('on the web it is granted when the browser has a camera API (the browser asks when the camera opens), else unavailable', async () => {
    setOs('web');
    const nav = globalThis as unknown as { navigator?: unknown };
    const saved = nav.navigator;
    try {
      nav.navigator = { mediaDevices: { getUserMedia: jest.fn() } };
      expect(await checkCamera()).toBe('granted');
      expect(await requestCamera()).toBe('granted');
      nav.navigator = {}; // a page that is not a secure context has no mediaDevices
      expect(await checkCamera()).toBe('unavailable');
      expect(await requestCamera()).toBe('unavailable');
    } finally {
      nav.navigator = saved;
    }
  });

  it('reports granted and denied without asking', async () => {
    setOs('android');
    const request = jest.spyOn(PermissionsAndroid, 'request');
    const check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    expect(await checkCamera()).toBe('granted');
    check.mockResolvedValue(false);
    expect(await checkCamera()).toBe('denied');
    check.mockRejectedValue(new Error('boom'));
    expect(await checkCamera()).toBe('denied');
    expect(request).not.toHaveBeenCalled();
  });

  it('asks with the rationale and maps the three answers', async () => {
    setOs('android');
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
    expect(await requestCamera()).toBe('granted');
    expect(request).toHaveBeenCalledWith('android.permission.CAMERA', expect.objectContaining({ message: BARCODE_COPY.rationale }));
    request.mockResolvedValue('denied');
    expect(await requestCamera()).toBe('denied');
    request.mockResolvedValue('never_ask_again');
    expect(await requestCamera()).toBe('blocked');
    request.mockRejectedValue(new Error('boom'));
    expect(await requestCamera()).toBe('denied');
  });

  it('asks with the text it is given, so another feature can say its own reason (pose tracking, #947)', async () => {
    setOs('android');
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
    const mine = { title: 'T', message: 'M', buttonPositive: 'Yes', buttonNegative: 'No' };
    await requestCamera(mine);
    expect(request).toHaveBeenCalledWith('android.permission.CAMERA', mine);
    await requestCamera();
    expect(request).toHaveBeenLastCalledWith('android.permission.CAMERA', expect.objectContaining({ title: BARCODE_COPY.rationaleTitle }));
  });
});
