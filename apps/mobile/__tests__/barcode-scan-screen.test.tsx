import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BarcodeScanScreen } from '../src/barcode/BarcodeScanScreen';
import { BARCODE_COPY as t } from '../src/barcode/copy';
import type { CameraPermission } from '../src/barcode/permission';
import type { ScannerViewProps } from '../modules/plate-barcode-scanner';

// The native view needs a device; the fake records its props so a test can drive it as the native side would.
let scannerProps: ScannerViewProps | null = null;
jest.mock('../modules/plate-barcode-scanner', () => ({
  BarcodeScannerView: (props: ScannerViewProps) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    scannerProps = props;
    return <View testID="scanner" />;
  },
}));
const mockCheck = jest.fn<Promise<CameraPermission>, []>();
const mockRequest = jest.fn<Promise<CameraPermission>, []>();
jest.mock('../src/barcode/permission', () => ({ checkCamera: () => mockCheck(), requestCamera: () => mockRequest() }));
jest.mock('../src/haptics', () => ({ buzz: jest.fn() }));

const GOOD = '5000112637922';
const hit = (code: string, format = 'EAN_13') => act(async () => scannerProps!.onBarcode({ nativeEvent: { code, format } } as never));

const show = async (permission: CameraPermission) => {
  mockCheck.mockResolvedValue(permission);
  const onCode = jest.fn();
  const onClose = jest.fn();
  await render(<BarcodeScanScreen onCode={onCode} onClose={onClose} />);
  await waitFor(() => expect(mockCheck).toHaveBeenCalled());
  return { onCode, onClose };
};

beforeEach(() => {
  scannerProps = null;
  mockCheck.mockReset();
  mockRequest.mockReset();
});

describe('permission states', () => {
  it('shows nothing but the title while it checks', async () => {
    mockCheck.mockReturnValue(new Promise(() => undefined));
    await render(<BarcodeScanScreen onCode={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByTestId('scanner')).toBeNull();
    expect(screen.queryByLabelText(t.fieldLabel)).toBeNull();
  });

  it('granted: shows the viewfinder, and the number field only after "type instead"', async () => {
    await show('granted');
    expect(await screen.findByTestId('scanner')).toBeTruthy();
    expect(screen.getAllByText(t.viewfinder).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(t.fieldLabel)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.typeInstead }));
    expect(screen.getByLabelText(t.fieldLabel)).toBeTruthy();
  });

  it('denied: explains why, asks on a tap, and starts scanning when allowed', async () => {
    await show('denied');
    expect(await screen.findByText(t.rationale)).toBeTruthy();
    expect(screen.queryByTestId('scanner')).toBeNull();
    expect(screen.getByLabelText(t.fieldLabel)).toBeTruthy(); // manual entry is there already
    mockRequest.mockResolvedValue('granted');
    await fireEvent.press(screen.getByRole('button', { name: t.allowA11y }));
    expect(await screen.findByTestId('scanner')).toBeTruthy();
  });

  it('denied again: stays on the rationale and the manual field', async () => {
    await show('denied');
    mockRequest.mockResolvedValue('denied');
    await fireEvent.press(await screen.findByRole('button', { name: t.allowA11y }));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('scanner')).toBeNull();
    expect(screen.getByLabelText(t.fieldLabel)).toBeTruthy();
  });

  it('blocked: says the camera is off, offers Settings and the manual field', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await show('blocked');
    expect(await screen.findByText(t.denied)).toBeTruthy();
    expect(screen.queryByTestId('scanner')).toBeNull();
    expect(screen.getByLabelText(t.fieldLabel)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.openSettings }));
    expect(open).toHaveBeenCalled();
  });

  it('a request that ends blocked shows the camera-off message', async () => {
    await show('denied');
    mockRequest.mockResolvedValue('blocked');
    await fireEvent.press(await screen.findByRole('button', { name: t.allowA11y }));
    expect(await screen.findByText(t.denied)).toBeTruthy();
  });

  it('unavailable (not Android): only the manual field', async () => {
    await show('unavailable');
    expect(await screen.findByText(t.unavailable)).toBeTruthy();
    expect(screen.queryByTestId('scanner')).toBeNull();
    expect(screen.getByLabelText(t.fieldLabel)).toBeTruthy();
  });
});

describe('scanning', () => {
  it('reports the digits and format of a read and pauses the scanner', async () => {
    const { onCode } = await show('granted');
    await screen.findByTestId('scanner');
    expect(scannerProps!.active).toBe(true);
    await hit(GOOD);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith(GOOD, { kind: 'scan', format: 'EAN_13' });
    expect(scannerProps!.active).toBe(false);
  });

  it('ignores a read whose check digit is wrong, says so, and re-arms on "Scan again"', async () => {
    const { onCode } = await show('granted');
    await screen.findByTestId('scanner');
    await hit('5000112637921');
    expect(onCode).not.toHaveBeenCalled();
    expect(screen.getByText(t.invalid)).toBeTruthy();
    expect(scannerProps!.active).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: t.scanAgain }));
    expect(scannerProps!.active).toBe(true);
    expect(screen.queryByText(t.invalid)).toBeNull();
  });

  it('shows the torch button only when the phone has a flash, and toggles it', async () => {
    await show('granted');
    await screen.findByTestId('scanner');
    expect(screen.queryByRole('button', { name: t.torchOn })).toBeNull();
    await act(async () => scannerProps!.onReady!({ nativeEvent: { torch: true } } as never));
    expect(scannerProps!.torch).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: t.torchOn }));
    expect(scannerProps!.torch).toBe(true);
    expect(screen.getByRole('button', { name: t.torchOff })).toBeTruthy();
  });

  it('a camera error drops to manual entry', async () => {
    await show('granted');
    await screen.findByTestId('scanner');
    await act(async () => scannerProps!.onError!({ nativeEvent: { message: 'camera_failed' } } as never));
    expect(screen.queryByTestId('scanner')).toBeNull();
    expect(screen.getByText(t.cameraFailed)).toBeTruthy();
    expect(screen.getByLabelText(t.fieldLabel)).toBeTruthy();
  });
});

describe('manual entry', () => {
  const type = (v: string) => fireEvent.changeText(screen.getByLabelText(t.fieldLabel), v);

  it('accepts a valid number, with spaces, and reports it as typed', async () => {
    const { onCode } = await show('unavailable');
    await screen.findByLabelText(t.fieldLabel);
    await type('5000 1126 37922');
    await fireEvent.press(screen.getByRole('button', { name: t.use }));
    expect(onCode).toHaveBeenCalledWith(GOOD, { kind: 'typed' });
  });

  it('rejects a wrong check digit and clears the message on the next keystroke', async () => {
    const { onCode } = await show('unavailable');
    await screen.findByLabelText(t.fieldLabel);
    await type('5000112637921');
    await fireEvent.press(screen.getByRole('button', { name: t.use }));
    expect(screen.getByText(t.invalid)).toBeTruthy();
    expect(onCode).not.toHaveBeenCalled();
    await type('50001126379');
    expect(screen.queryByText(t.invalid)).toBeNull();
  });

  it('works with the camera granted too (always available)', async () => {
    const { onCode } = await show('granted');
    await fireEvent.press(await screen.findByRole('button', { name: t.typeInstead }));
    await type('96385074');
    await fireEvent.press(screen.getByRole('button', { name: t.use }));
    expect(onCode).toHaveBeenCalledWith('96385074', { kind: 'typed' });
  });

  it('Close calls onClose', async () => {
    const { onClose } = await show('unavailable');
    await fireEvent.press(await screen.findByRole('button', { name: t.close }));
    expect(onClose).toHaveBeenCalled();
  });
});
