import { render, screen } from '@testing-library/react-native';
import { Gate } from '../src/state/Gate';

let mockStatus: 'loading' | 'ready' = 'loading';
jest.mock('expo-router', () => ({ usePathname: () => '/', useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useGlobalSearchParams: () => ({}) }));
jest.mock('../src/state/ProfileProvider', () => ({ useProfile: () => ({ status: mockStatus, profile: null, skipped: false }) }));

describe('cold load (#1144)', () => {
  it('the Gate shows the skeleton (one Loading line, no extra main landmark), not a spinner, and is marked busy while the profile loads', async () => {
    mockStatus = 'loading';
    await render(<Gate />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('gate-cover').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
    expect(screen.queryByLabelText('Loading')).toBeNull();
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('the Gate renders nothing once the profile is ready', async () => {
    mockStatus = 'ready';
    await render(<Gate />);
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });
});
