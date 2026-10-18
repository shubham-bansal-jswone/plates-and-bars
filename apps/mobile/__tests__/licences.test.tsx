import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AboutScreen } from '../src/about/AboutScreen';
import { cachedLoader, loadLicences, licenceRows, type LicenceData } from '../src/about/licences';

// Jest cannot run a dynamic import() without --experimental-vm-modules; `expo export --platform web` exercises the real split chunk.
const mockLoad = jest.fn(() => Promise.resolve(jest.requireActual('../src/about/licences.json')));
jest.mock('../src/about/licences', () => ({ ...jest.requireActual('../src/about/licences'), loadLicences: () => mockLoad() }));

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
  it('gives every entry a licence, and lists the fonts, Ionicons and the pose model files', () => {
    for (const e of [...d.packages, ...d.android, ...d.assets]) expect(e.licence).toBeTruthy();
    expect(d.assets.map((a) => a.name)).toEqual(['Inter (font)', 'Roboto (font)', 'Ionicons (icons)', 'MoveNet Lightning (pose model weights)', 'TensorFlow.js WebAssembly runtime (pose tracking)']);
    for (const e of d.assets) expect(d.texts[e.text!]).toBeTruthy();
  });
  it('only references texts that exist', () => {
    for (const e of [...d.packages, ...d.android, ...d.native, ...d.assets]) if (e.text) expect(d.texts[e.text]).toBeTruthy();
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
      expect(d.texts[a.text!]).toBeTruthy();
    }
    expect(d.android.filter((a) => !a.version)).toEqual([]);
  });
  it('builds headings and entries with unique keys', () => {
    const rows = licenceRows(d);
    expect(rows.filter((r) => r.kind === 'heading')).toHaveLength(4);
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
    expect(screen.getByRole('header', { name: 'Fonts, icons and model files' })).toBeTruthy();
    const row = screen.getByLabelText('Inter (font), Licence: OFL-1.1');
    expect(row.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(row);
    expect(screen.getByLabelText('Inter (font), Licence: OFL-1.1').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText(/SIL OPEN FONT LICENSE Version 1.1/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(screen.getByText('About and sources')).toBeTruthy();
  });
});

describe('licence list loading', () => {
  it('shows an error with a retry when loading fails, and loads on retry', async () => {
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    await render(<AboutScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByLabelText('View open-source licences'));
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('Loading licences')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Fonts, icons and model files' })).toBeTruthy());
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('does not cache a failure, and caches a success', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('data');
    const get = cachedLoader(load);
    await expect(get()).rejects.toThrow('offline');
    await expect(get()).resolves.toBe('data');
    await expect(get()).resolves.toBe('data');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('Native component notices', () => {
  it('lists the third-party code compiled into the .so files, each with its upstream copyright text', async () => {
    const d = await loadLicences();
    const by = (n: string) => d.native.find((c) => c.name === n)!;
    for (const c of d.native) {
      expect(c.version).toBeTruthy();
      expect(c.licence).toBeTruthy();
      expect(c.in?.length).toBeGreaterThan(0);
      expect(d.texts[c.text!]).toBeTruthy();
    }
    expect(d.native.map((c) => c.name)).toEqual(expect.arrayContaining(['Folly', 'glog', '{fmt}', 'libjpeg-turbo', 'libwebp', 'giflib', 'SQLite', 'Zstandard']));
    expect(d.texts[by('libwebp').text!]).toContain('Copyright (c) 2010, Google Inc.');
    expect(d.texts[by('glog').text!]).toContain('Copyright (c) 2008, Google Inc.');
    expect(d.texts[by('giflib').text!]).toContain('Copyright (c) 1997  Eric S. Raymond');
    expect(d.texts[by('libjpeg-turbo').text!]).toContain('Independent JPEG Group');
    expect(by('libwebp').in).toEqual(['libstatic-webp.so']);
    expect(by('{fmt}').in).toEqual(['libreactnative.so']);
  });
});

describe('Android licence notices', () => {
  it('carry the real upstream copyright notice for every MIT and BSD library', async () => {
    const d = await loadLicences();
    const text = (n: string) => d.texts[d.android.find((a) => a.name.startsWith(n))!.text!];
    expect(text('com.facebook.fresco:fresco')).toContain('Copyright (c) Meta Platforms, Inc. and affiliates.');
    expect(text('com.facebook.yoga:')).toContain('Copyright (c) Facebook, Inc. and its affiliates.');
    expect(text('com.facebook.infer.annotation:')).toContain('Copyright (c) Facebook, Inc. and its affiliates.');
    expect(text('com.github.bumptech.glide:')).toContain('Copyright 2014 Google, Inc.');
    expect(text('org.brotli:')).toContain('Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors.');
    expect(text('io.sentry:')).toContain('Copyright (c) 2019 Sentry');
    expect(text('io.github.expo.pika:')).toContain('Copyright (c) 2026 Lukasz Kosmaty');
    expect(text('io.github.expo.kolibri:')).toContain('650 Industries');
    expect(text('io.github.expo:expo-modules-v2-react')).toContain('650 Industries');
    expect(text('com.google.code.findbugs:jsr305')).toContain('Copyright (c) 2007-2009, JSR305 expert group');
    for (const a of d.android.filter((x) => /^(MIT|BSD)/.test(x.licence))) expect(d.texts[a.text!]).toMatch(/Copyright/);
    expect(d.android.find((a) => a.name === 'io.github.expo.kolibri:kolibri-android')?.version).toBe('0.2.3');
  });
});
