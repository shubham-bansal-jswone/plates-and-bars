import { render, screen } from '@testing-library/react-native';
import { BottomInsetPadded } from '../src/components/bottomInset';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { LicencesScreen } from '../src/about/LicencesScreen';

let mockBottom = 48;
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: mockBottom, left: 0, right: 0 }) }));
jest.mock('../src/about/licences', () => ({ ...jest.requireActual('../src/about/licences'), loadLicences: () => new Promise(() => {}) }));

const LIST_PAD = 16; // both lists' own padding

const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
/** All the bottom padding between a list's header and the screen edge, summed over its ancestors (the header sits inside the content container). */
function listPaddingBottom(heading: string): number {
  let sum = 0;
  for (let n = screen.getByText(heading).parent; n; n = n.parent) {
    const st = flat([n.props.style, n.props.contentContainerStyle]);
    sum += st.paddingBottom ?? st.padding ?? 0;
  }
  return sum;
}

/** The last row of a FlatList stack screen must clear the Android navigation bar, exactly once (#1065). */
describe.each([
  ['ExerciseLibraryScreen', 'Exercise library', () => <ExerciseLibraryScreen onBack={() => {}} />],
  ['LicencesScreen', 'Open-source licences', () => <LicencesScreen onBack={() => {}} />],
] as const)('%s bottom safe-area inset', (_name, heading, screenEl) => {
  beforeEach(() => {
    mockBottom = 48;
  });

  it('keeps the last row clear of the navigation bar', async () => {
    await render(screenEl());
    expect(listPaddingBottom(heading)).toBe(LIST_PAD + 48);
  });

  it('adds nothing extra where the inset is 0', async () => {
    mockBottom = 0;
    await render(screenEl());
    expect(listPaddingBottom(heading)).toBe(LIST_PAD);
  });

  it('does not add the inset twice inside the tabs', async () => {
    await render(<BottomInsetPadded.Provider value>{screenEl()}</BottomInsetPadded.Provider>);
    expect(listPaddingBottom(heading)).toBe(LIST_PAD);
  });
});
