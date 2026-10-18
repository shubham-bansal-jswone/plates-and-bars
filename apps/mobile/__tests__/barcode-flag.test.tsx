import { render, screen } from '@testing-library/react-native';
import BarcodeDev from '../app/barcode-dev';
import { barcodeScanEnabled } from '../src/barcode/flag';

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (p: { href: string }) => {
    mockRedirect(p.href);
    return null;
  },
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock('../src/barcode/BarcodeScanScreen', () => ({
  BarcodeScanScreen: () => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>scanner screen</Text>;
  },
}));

describe('barcode scanner feature flag (#944)', () => {
  const saved = process.env.EXPO_PUBLIC_BARCODE_SCAN;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_BARCODE_SCAN;
    else process.env.EXPO_PUBLIC_BARCODE_SCAN = saved;
    mockRedirect.mockClear();
  });

  it('is off unless set to exactly 1', () => {
    expect(barcodeScanEnabled(undefined)).toBe(false);
    expect(barcodeScanEnabled('')).toBe(false);
    expect(barcodeScanEnabled('true')).toBe(false);
    expect(barcodeScanEnabled('0')).toBe(false);
    expect(barcodeScanEnabled('1')).toBe(true);
  });

  it('the dev route sends you home while the flag is off', async () => {
    delete process.env.EXPO_PUBLIC_BARCODE_SCAN;
    await render(<BarcodeDev />);
    expect(mockRedirect).toHaveBeenCalledWith('/');
    expect(screen.queryByText('scanner screen')).toBeNull();
  });

  it('the dev route shows the scanner when the flag is on', async () => {
    process.env.EXPO_PUBLIC_BARCODE_SCAN = '1';
    await render(<BarcodeDev />);
    expect(screen.getByText('scanner screen')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
