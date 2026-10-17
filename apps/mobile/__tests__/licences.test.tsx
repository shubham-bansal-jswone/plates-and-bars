import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AboutScreen } from '../src/about/AboutScreen';
import { getLicences, licenceRows } from '../src/about/licences';

describe('generated licences.json', () => {
  const d = getLicences();
  it('is non-empty and includes react-native and @expo/vector-icons', () => {
    expect(d.packages.length).toBeGreaterThan(100);
    const names = d.packages.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['react-native', '@expo/vector-icons']));
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
  it('builds headings and entries with unique keys', () => {
    const { rows } = licenceRows();
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
