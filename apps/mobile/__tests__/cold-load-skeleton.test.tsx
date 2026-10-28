import { render, screen } from '@testing-library/react-native';
import { Gate } from '../src/state/Gate';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';

let mockStatus: 'loading' | 'ready' = 'loading';
jest.mock('expo-router', () => ({ usePathname: () => '/', useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useGlobalSearchParams: () => ({}) }));
jest.mock('../src/state/ProfileProvider', () => ({ useProfile: () => ({ status: mockStatus, profile: null, skipped: false }) }));
const mockSkeleton = jest.fn();
jest.mock('../src/components/Skeleton', () => {
  const actual = jest.requireActual('../src/components/Skeleton');
  return { Skeleton: (p: object) => (mockSkeleton(), actual.Skeleton(p)) };
});

describe('cold load (#1144)', () => {
  beforeEach(() => mockSkeleton.mockClear());

  it('the Gate shows the skeleton, not a spinner, and is marked busy while the profile loads', async () => {
    mockStatus = 'loading';
    await render(<Gate />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByLabelText('Loading').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('the Gate renders nothing once the profile is ready', async () => {
    mockStatus = 'ready';
    await render(<Gate />);
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });

  it('the Library paints the skeleton first, then the list', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    expect(mockSkeleton).toHaveBeenCalled();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(screen.getByText('Exercise library')).toBeTruthy();
  });

  it('the Library shows a list passed in at once, without the skeleton', async () => {
    await render(<ExerciseLibraryScreen onBack={() => {}} list={[]} />);
    expect(mockSkeleton).not.toHaveBeenCalled();
  });
});
