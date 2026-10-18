import { PermissionsAndroid, Platform } from 'react-native';

import { deviceStepsSupported, readStepCounter, requestStepPermission, stepPermissionGranted, stepSensorPresent } from '../src/steps/sensor';

const mockNative = { isAvailableAsync: jest.fn(), readCounterAsync: jest.fn() };
let mockHasModule = true;
jest.mock('expo', () => ({ requireOptionalNativeModule: () => (mockHasModule ? mockNative : null) }));


const setPlatform = (os: string, version: number | string = 34) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
};
const rationale = { title: 't', message: 'm', buttonPositive: 'y', buttonNegative: 'n' };

afterEach(() => {
  jest.restoreAllMocks();
  mockHasModule = true;
  mockNative.isAvailableAsync.mockReset();
  mockNative.readCounterAsync.mockReset();
});

describe('on web and iOS the step sensor is not there (manual entry only)', () => {
  it.each(['web', 'ios'])('%s', async (os) => {
    setPlatform(os);
    expect(deviceStepsSupported()).toBe(false);
    expect(await stepSensorPresent()).toBe(false);
    expect(await readStepCounter()).toBeNull();
    expect(mockNative.readCounterAsync).not.toHaveBeenCalled();
  });
});

describe('on Android', () => {
  beforeEach(() => setPlatform('android', 34));

  it('is unsupported in a build without the module (Expo Go)', async () => {
    mockHasModule = false;
    expect(deviceStepsSupported()).toBe(false);
    expect(await readStepCounter()).toBeNull();
  });

  it('reads the sensor and the counter', async () => {
    mockNative.isAvailableAsync.mockResolvedValue(true);
    mockNative.readCounterAsync.mockResolvedValue({ counter: 1234, elapsedMs: 99 });
    expect(deviceStepsSupported()).toBe(true);
    expect(await stepSensorPresent()).toBe(true);
    expect(await readStepCounter()).toEqual({ counter: 1234, elapsedMs: 99 });
  });

  it('turns every failure into "no sensor" or "no reading"', async () => {
    mockNative.isAvailableAsync.mockRejectedValue(new Error('x'));
    expect(await stepSensorPresent()).toBe(false);
    mockNative.readCounterAsync.mockRejectedValue(new Error('x'));
    expect(await readStepCounter()).toBeNull();
    mockNative.readCounterAsync.mockResolvedValue(null);
    expect(await readStepCounter()).toBeNull();
    mockNative.readCounterAsync.mockResolvedValue({ counter: Number.NaN, elapsedMs: 1 });
    expect(await readStepCounter()).toBeNull();
  });

  it('asks for ACTIVITY_RECOGNITION with the rationale on API 29 and later', async () => {
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    expect(await stepPermissionGranted()).toBe(false);
    expect(await requestStepPermission(rationale)).toBe(true);
    expect(request).toHaveBeenCalledWith('android.permission.ACTIVITY_RECOGNITION', rationale);
    request.mockResolvedValue('never_ask_again');
    expect(await requestStepPermission(rationale)).toBe(false);
    request.mockRejectedValue(new Error('x'));
    expect(await requestStepPermission(rationale)).toBe(false);
  });

  it('needs no permission before Android 10', async () => {
    setPlatform('android', 28);
    const request = jest.spyOn(PermissionsAndroid, 'request');
    expect(await stepPermissionGranted()).toBe(true);
    expect(await requestStepPermission(rationale)).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
