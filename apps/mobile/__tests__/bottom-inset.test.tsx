import { Platform, Text } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import { BottomInsetPadded } from '../src/components/bottomInset';
import { ScanFlow } from '../src/barcode/ScanFlow';
import { BARCODE_COPY as t } from '../src/barcode/copy';
import type { ScannerViewProps } from '../modules/plate-barcode-scanner';
import { SheetModal } from '../src/components/Sheet';
import { Page } from '../src/components/ui';
import { EAN13 } from './barcode-fixtures';

let mockBottom = 48;
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: mockBottom, left: 0, right: 0 }) }));
let scannerProps: ScannerViewProps | null = null;
jest.mock('../modules/plate-barcode-scanner', () => ({
  BarcodeScannerView: (props: ScannerViewProps) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    scannerProps = props;
    return <View testID="scanner" />;
  },
}));
jest.mock('../src/barcode/permission', () => ({ checkCamera: async () => 'granted', requestCamera: async () => 'granted' }));

const PAGE_PAD = 16; // Page's own bottom padding

const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
/** All the bottom padding between the text and the screen edge, summed over its ancestors. */
function paddingBelow(text: string): number {
  let sum = 0;
  for (let n = screen.getByText(text).parent; n; n = n.parent) {
    sum += flat([n.props.style, n.props.contentContainerStyle]).paddingBottom ?? 0;
  }
  return sum;
}

/** The last button on a long page must clear the Android navigation bar, exactly once (#1059). */
describe('bottom safe-area inset', () => {
  beforeEach(() => {
    mockBottom = 48;
    scannerProps = null;
  });
  afterEach(() => jest.restoreAllMocks());

  it('Page keeps its content clear of the navigation bar', async () => {
    await render(<Page><Text>end</Text></Page>);
    expect(paddingBelow('end')).toBe(PAGE_PAD + 48);
  });

  it('Page adds nothing extra where the inset is 0 (web, gesture-less phones)', async () => {
    mockBottom = 0;
    await render(<Page><Text>end</Text></Page>);
    expect(paddingBelow('end')).toBe(PAGE_PAD);
  });

  it('Page inside the tabs does not add the inset twice, the tab bar already pads it', async () => {
    await render(<BottomInsetPadded.Provider value><Page><Text>end</Text></Page></BottomInsetPadded.Provider>);
    expect(paddingBelow('end')).toBe(PAGE_PAD);
  });

  it('a Page inside a sheet opened from a stack screen gets the inset once', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<SheetModal title="Add" onClose={() => {}}><Page><Text>end</Text></Page></SheetModal>);
    expect(paddingBelow('end')).toBe(PAGE_PAD + 48);
  });

  it('a sheet opened from the tabs still pads the inset, once', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<BottomInsetPadded.Provider value><SheetModal title="Add" onClose={() => {}}><Page><Text>end</Text></Page></SheetModal></BottomInsetPadded.Provider>);
    expect(paddingBelow('end')).toBe(PAGE_PAD + 48);
  });

  it('a Page inside the barcode flow opened from the tabs gets the inset once', async () => {
    await render(
      <BottomInsetPadded.Provider value>
        <ScanFlow meal="Breakfast" mine={[]} onAdd={() => {}} onSaveMine={() => undefined as never} onCustom={() => {}} onClose={() => {}} onDone={() => {}} lookup={() => new Promise(() => {})} />
      </BottomInsetPadded.Provider>,
    );
    await screen.findByTestId('scanner');
    await act(async () => scannerProps!.onBarcode({ nativeEvent: { code: EAN13, format: 'EAN_13' } } as never));
    expect(paddingBelow(t.looking)).toBe(PAGE_PAD + 48);
  });
});
