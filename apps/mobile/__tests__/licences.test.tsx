import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AboutScreen } from '../src/about/AboutScreen';
import { loadLicences, licenceRows, type LicenceData } from '../src/about/licences';

// Jest cannot run a dynamic import() without --experimental-vm-modules; `expo export --platform web` exercises the real split chunk.
jest.mock('../src/about/licences', () => ({
  ...jest.requireActual('../src/about/licences'),
  loadLicences: () => Promise.resolve(jest.requireActual('../src/about/licences.json')),
}));

describe('generated licences.json', () => {
  let d: LicenceData;
  beforeAll(async () => {
    d = await loadLicences();
  });
  it('is non-empty and includes react-native and @expo/vector-icons', () => {
    expect(d.packages.length).toBeGreaterThan(100);
    const names = d.packages.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['react-native', '@expo/vector-icons']));
    expect(d.packages.find((p) => p.name === '@sentry/cli')).toMatchObject({ version: '0.0.0-stub', licence: 'MIT' });
    expect(d.android.length).toBeGreaterThan(10);
  });
  it('gives every entry a licence, and lists the fonts and Ionicons', () => {
    for (const e of [...d.packages, ...d.android, ...d.assets]) expect(e.licence).toBeTruthy();
    expect(d.assets.map((a) => a.name)).toEqual(['Inter (font)', 'Roboto (font)', 'Ionicons (icons)']);
    for (const e of d.assets) expect(d.texts[e.text!]).toBeTruthy();
  });
  it('only references texts that exist', () => {
    for (const e of [...d.packages, ...d.android, ...d.assets]) if (e.text) expect(d.texts[e.text]).toBeTruthy();
  });
  it('lists Android libraries with a version, licence, licence URL and text', () => {
    const by = (n: string) => d.android.find((a) => a.name === n)!;
    expect(by('com.facebook.soloader:soloader').licence).toBe('Apache-2.0');
    expect(by('com.facebook.fbjni:fbjni').licence).toBe('Apache-2.0');
    expect(by('com.facebook.fresco:fresco').licence).toBe('MIT');
    expect(by('io.sentry:sentry-android').licence).toBe('MIT');
    expect(by('org.jetbrains.kotlin:kotlin-stdlib').version).toMatch(/^\d/);
    for (const a of d.android) {
      expect(a.url).toMatch(/^https:\/\//);
      if (!a.licence.includes('CDDL')) expect(d.texts[a.text!]).toBeTruthy();
    }
    expect(d.android.filter((a) => a.version === null).map((a) => a.name)).toEqual(['io.github.expo.kolibri:kolibri-android']);
  });
  it('builds headings and entries with unique keys', () => {
    const rows = licenceRows(d);
    expect(rows.filter((r) => r.kind === 'heading')).toHaveLength(3);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('About screen licences section', () => {
  it('links to LICENSE, NOTICE and THIRD_PARTY.md', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Open-source licences')).toBeTruthy();
    for (const l of ['LICENSE (Apache-2.0, code)', 'NOTICE', 'THIRD_PARTY.md']) expect(screen.getByLabelText(`Open ${l}`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open THIRD_PARTY.md'));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('THIRD_PARTY.md'));
  });

  it('opens an accessible list with headings and expandable notices, and goes back', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByLabelText('View open-source licences'));
    await waitFor(() => expect(screen.queryByText('Loading licences')).toBeNull());
    expect(screen.getByRole('header', { name: 'Fonts and icons' })).toBeTruthy();
    const row = screen.getByLabelText('Inter (font), Licence: OFL-1.1');
    expect(row.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(row);
    expect(screen.getByLabelText('Inter (font), Licence: OFL-1.1').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText(/SIL OPEN FONT LICENSE Version 1.1/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(screen.getByText('About and sources')).toBeTruthy();
  });
});
