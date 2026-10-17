import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { AboutScreen } from '../src/about/AboutScreen';
import { appVersion, errorRelease, versionLine } from '../src/appVersion';

let mockConfig: { version?: string; android?: { versionCode?: number } } | null = null;
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return mockConfig; } } }));

const os = (name: string) => jest.replaceProperty(Platform, 'OS', name as 'android');

describe('app version', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads version and build from the app config', () => {
    mockConfig = { version: '1.2.3', android: { versionCode: 1002003 } };
    expect(appVersion()).toEqual({ version: '1.2.3', build: '1002003' });
    mockConfig = { version: '0.1.0' };
    expect(appVersion()).toEqual({ version: '0.1.0', build: null });
    mockConfig = null;
    expect(appVersion()).toBeNull();
  });

  it('formats "Version X.Y.Z (versionCode)" on Android and the version alone elsewhere', () => {
    mockConfig = { version: '1.2.3', android: { versionCode: 1002003 } };
    os('android');
    expect(versionLine()).toBe('Version 1.2.3 (1002003)');
    jest.restoreAllMocks();
    os('web');
    expect(versionLine()).toBe('Version 1.2.3');
    mockConfig = { version: '1.2.3' };
    jest.restoreAllMocks();
    os('android');
    expect(versionLine()).toBe('Version 1.2.3');
    mockConfig = null;
    expect(versionLine()).toBeNull();
  });

  it('builds the error release as plate-and-bar@X.Y.Z+versionCode', () => {
    mockConfig = { version: '1.2.3', android: { versionCode: 1002003 } };
    expect(errorRelease()).toBe('plate-and-bar@1.2.3+1002003');
    mockConfig = { version: '1.2.3' };
    expect(errorRelease()).toBe('plate-and-bar@1.2.3');
    mockConfig = null;
    expect(errorRelease()).toBeUndefined();
  });

  it('shows the version on About on Android and web, and nothing when unknown', async () => {
    mockConfig = { version: '1.2.3', android: { versionCode: 1002003 } };
    os('android');
    const first = await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Version 1.2.3 (1002003)')).toBeTruthy();
    await first.unmount();
    jest.restoreAllMocks();
    os('web');
    const second = await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Version 1.2.3')).toBeTruthy();
    await second.unmount();
    mockConfig = null;
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.queryByText(/^Version /)).toBeNull();
  });
});
