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
});
