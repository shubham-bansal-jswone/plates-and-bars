import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AboutScreen } from '../src/about/AboutScreen';
import { legalLinks, siteBase } from '../src/legal/siteLinks';
import { DataScreen } from '../src/screens/DataScreen';
import { SetupScreen } from '../src/screens/SetupScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NAMES = ['Privacy policy', 'Terms', 'Delete your account'];
const original = process.env.EXPO_PUBLIC_SITE_URL;
afterEach(() => {
  if (original === undefined) delete process.env.EXPO_PUBLIC_SITE_URL;
  else process.env.EXPO_PUBLIC_SITE_URL = original;
});

const syncState = { configured: true, signedIn: false, linked: false, wipePending: false, lastDeletion: null, clearLastDeletion: () => undefined, pending: 0 } as unknown as SyncState;
const screens: [string, () => React.ReactElement][] = [
  ['About', () => <AboutScreen onBack={() => {}} />],
  ['Your data', () => (
    <SyncContext.Provider value={syncState}>
      <DataScreen db={memoryDb()} />
    </SyncContext.Provider>
  )],
  ['setup consent', () => withProfile(memoryDb(), <SetupScreen />)],
];

describe('site URLs', () => {
  it('builds each URL with one slash, whatever the trailing slashes of the origin', () => {
    for (const base of ['https://plate.example', 'https://plate.example/', 'https://plate.example///', ' https://plate.example ']) {
      expect(legalLinks(base).map((l) => l.url)).toEqual(['https://plate.example/privacy/', 'https://plate.example/terms/', 'https://plate.example/delete-account/']);
    }
    expect(siteBase('https://example.org/site/')).toBe('https://example.org/site');
  });

  it('gives no links when unset, blank, not https or malformed', () => {
    for (const v of [undefined, '', '   ', 'http://plate.example', 'plate.example', 'https://', 'https://a b', 'javascript:alert(1)', 'https://x.example/?q=1']) {
      expect(legalLinks(v)).toEqual([]);
    }
  });
});

describe.each(screens)('legal links on %s', (_name, ui) => {
  it('shows three named links that open the site pages', async () => {
    process.env.EXPO_PUBLIC_SITE_URL = 'https://plate.example/';
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(ui());
    for (const n of NAMES) expect(await screen.findByRole('link', { name: n })).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Privacy policy' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Terms' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Delete your account' }));
    expect(open.mock.calls.map((c) => c[0])).toEqual(['https://plate.example/privacy/', 'https://plate.example/terms/', 'https://plate.example/delete-account/']);
    open.mockRestore();
  });

  it('hides them when the site URL is unset', async () => {
    delete process.env.EXPO_PUBLIC_SITE_URL;
    await render(ui());
    await screen.findAllByText(/./);
    for (const n of NAMES) expect(screen.queryByRole('link', { name: n })).toBeNull();
  });
});
