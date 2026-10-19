import { Platform, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { TabBarOwnsBottomInset } from '../src/components/bottomInset';
import { SheetModal } from '../src/components/Sheet';
import { Page } from '../src/components/ui';

let mockBottom = 48;
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: mockBottom, left: 0, right: 0 }) }));

const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
/** The bottom padding the nearest padded ancestor of the text gives it. */
function paddingBelow(text: string): number | undefined {
  for (let n = screen.getByText(text).parent; n; n = n.parent) {
    const p = flat([n.props.style, n.props.contentContainerStyle]).paddingBottom;
    if (p !== undefined) return p;
  }
  return undefined;
}

/** The last button on a long page must clear the Android navigation bar (#1059). */
describe('bottom safe-area inset', () => {
  beforeEach(() => {
    mockBottom = 48;
  });

  it('Page keeps its content clear of the navigation bar', async () => {
    await render(<Page><Text>end</Text></Page>);
    expect(paddingBelow('end')).toBe(16 + 48);
  });

  it('Page adds nothing extra where the inset is 0 (web, gesture-less phones)', async () => {
    mockBottom = 0;
    await render(<Page><Text>end</Text></Page>);
    expect(paddingBelow('end')).toBe(16);
  });

  it('Page inside the tabs does not add the inset twice, the tab bar already pads it', async () => {
    await render(<TabBarOwnsBottomInset.Provider value><Page><Text>end</Text></Page></TabBarOwnsBottomInset.Provider>);
    expect(paddingBelow('end')).toBe(16);
  });

  it('a sheet keeps clear of the bar even when opened from the tabs', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<TabBarOwnsBottomInset.Provider value><SheetModal title="Add" onClose={() => {}}><Text>body</Text></SheetModal></TabBarOwnsBottomInset.Provider>);
    expect(paddingBelow('body')).toBe(48);
  });
});
