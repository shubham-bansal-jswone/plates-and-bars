import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, Platform, StyleSheet } from 'react-native';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import { blankRow, type ExState, type Row } from '../src/workout/model';
import { buildShareCard, CARD_H, CARD_MAX_ROWS, CARD_PAD, CARD_W, HEADER_H, MORE_H, ROW_H, STATS_H } from '../src/workout/shareModel';
import { memoryDb } from './helpers';

const mockCapture = jest.fn(async () => 'file:///cache/ReactNative-snapshot-image-1.png');
const mockShare = jest.fn(async () => undefined);
const mockCopied: string[] = [];
jest.mock('react-native-view-shot', () => ({ captureRef: (...a: unknown[]) => (mockCapture as (...x: unknown[]) => Promise<string>)(...a) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: (...a: unknown[]) => (mockShare as (...x: unknown[]) => Promise<void>)(...a) }));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = false;
    constructor(a: unknown, name?: string) {
      this.uri = name ? `file:///cache/${name}` : String(a);
    }
    copy(dest: { uri: string }) {
      mockCopied.push(dest.uri);
    }
    delete() {}
  }
  return { File, Directory: class {}, Paths: { cache: 'cache' } };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

const row = (w: string, r: string, done: boolean, rate: Row['rate'] = null): Row => ({ ...blankRow(), w, r, done, rate });
const ex = (name: string, sets: Row[]): ExState => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets });
const exs = [ex('Barbell Bench Press', [row('60', '8', true, 'hard'), row('62.5', '6', true)]), ex('Pec Deck Fly', [row('30', '12', true)])];
const panel = () => render(<CompletionPanel db={memoryDb()} date="2026-10-08" profileKg={83.7} exs={exs} cardio={null} lifts={{ 'Barbell Bench Press': { pbToast: '2026-10-08' } as never }} reloadKey={0} />);
const original = Platform.OS;
afterEach(() => {
  Platform.OS = original;
  jest.clearAllMocks();
  mockCopied.length = 0;
});

describe('share the workout summary picture', () => {
  it('shows a secondary Share button once the session is complete, and none while a set is undone', async () => {
    await panel();
    expect(screen.getByLabelText('Share workout summary picture')).toBeTruthy();
    expect(screen.getByTestId('share-card', { includeHiddenElements: true })).toBeTruthy();
    await screen.unmount();
    await render(<CompletionPanel db={memoryDb()} date="2026-10-08" profileKg={80} exs={[ex('Pec Deck Fly', [row('30', '12', false)])]} cardio={null} lifts={{}} reloadKey={0} />);
    expect(screen.queryByLabelText('Share workout summary picture')).toBeNull();
  });

  it('captures the card as a 1080x1350 PNG and hands the file to the share sheet, nothing else', async () => {
    await panel();
    fireEvent.press(screen.getByLabelText('Share workout summary picture'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    expect(mockCapture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: 'png', width: 1080, height: 1350, result: 'tmpfile' }));
    const [uri, opts] = mockShare.mock.calls[0] as unknown as [string, { mimeType: string }];
    expect(uri).toMatch(/^file:\/\/\/cache\/plate-and-bar-.*\.png$/);
    expect(opts.mimeType).toBe('image/png');
    expect(mockCopied).toEqual([uri]);
  });

  it('says so when the capture fails, and does not open the share sheet', async () => {
    mockCapture.mockRejectedValueOnce(new Error('boom'));
    await panel();
    fireEvent.press(screen.getByLabelText('Share workout summary picture'));
    await waitFor(() => expect(screen.getByText('Could not share the picture. Try again.')).toBeTruthy());
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('web: draws the card on a canvas and downloads the PNG instead of sharing; the object URL is revoked and globals restored', async () => {
    Platform.OS = 'web';
    jest.useFakeTimers();
    const calls: string[] = [];
    const g = new Proxy({}, { set: () => true, get: (_t, k) => (k === 'fillText' ? (s: string) => calls.push(s) : k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : () => undefined) });
    const anchor = { click: jest.fn(), remove: jest.fn(), href: '', download: '' };
    const revoke = jest.fn();
    const g0 = globalThis as unknown as Record<string, unknown>;
    const saved = { document: g0.document, URL: g0.URL };
    g0.document = {
      createElement: (t: string) => (t === 'canvas' ? { getContext: () => g, toBlob: (cb: (b: unknown) => void) => cb({ type: 'image/png' }) } : anchor),
      body: { appendChild: jest.fn() },
    };
    g0.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: revoke };
    try {
      const { shareWorkoutImage } = jest.requireActual<typeof import('../src/workout/shareImage')>('../src/workout/shareImage.ts'); // the web file, by name (the bare path picks .native.ts)
      expect(await shareWorkoutImage(buildShareCard({ date: '2026-10-08', exs, cardio: null, lifts: {} }))).toBe('saved');
      expect(anchor.download).toBe('plate-and-bar-workout-summary.png');
      expect(anchor.click).toHaveBeenCalled();
      expect(calls).toContain('Barbell Bench Press');
      expect(mockShare).not.toHaveBeenCalled();
      jest.runAllTimers();
      expect(revoke).toHaveBeenCalledWith('blob:x');
    } finally {
      jest.useRealTimers();
      g0.document = saved.document;
      g0.URL = saved.URL;
    }
  });

  it('web canvas: a very long exercise name is cut with an ellipsis inside its box', async () => {
    Platform.OS = 'web';
    jest.useFakeTimers();
    const widths: { s: string; w: number }[] = [];
    const g = new Proxy({}, { set: () => true, get: (_t, k) => (k === 'fillText' ? (s: string) => widths.push({ s, w: s.length * 10 }) : k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : () => undefined) });
    const g0 = globalThis as unknown as Record<string, unknown>;
    const saved = { document: g0.document, URL: g0.URL };
    g0.document = { createElement: (t: string) => (t === 'canvas' ? { getContext: () => g, toBlob: (cb: (b: unknown) => void) => cb({}) } : { click() {}, remove() {} }), body: { appendChild() {} } };
    g0.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
    try {
      const { shareWorkoutImage } = jest.requireActual<typeof import('../src/workout/shareImage')>('../src/workout/shareImage.ts');
      const name = 'A very long custom exercise name that would run under the best set'.repeat(2);
      await shareWorkoutImage(buildShareCard({ date: '2026-10-08', exs: [ex(name, [row('60', '8', true)])], cardio: null, lifts: {} }));
      const drawn = widths.find((x) => x.s.endsWith('…'));
      expect(drawn).toBeTruthy();
      expect(drawn!.w).toBeLessThanOrEqual(1080 - 120);
      jest.runAllTimers();
    } finally {
      jest.useRealTimers();
      g0.document = saved.document;
      g0.URL = saved.URL;
    }
  });

  it('a second tap while a share is running does not start another capture', async () => {
    let release: () => void = () => undefined;
    mockShare.mockImplementationOnce(() => new Promise<undefined>((ok) => (release = () => ok(undefined))));
    await panel();
    fireEvent.press(screen.getByLabelText('Share workout summary picture'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByLabelText('Share workout summary picture'));
    expect(mockCapture).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByLabelText('Share workout summary picture').props.accessibilityState?.disabled).toBeFalsy());
  });

  it('the card sits off screen even on a wide window', async () => {
    const before = Dimensions.get('window');
    Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
    try {
      await panel();
      const left = (StyleSheet.flatten(screen.getByTestId('share-card', { includeHiddenElements: true }).props.style) as { left: number }).left;
      expect(left).toBeLessThanOrEqual(-(1280 + CARD_W));
    } finally {
      Dimensions.set({ window: before });
    }
  });

  it('every text in the card ignores the system text size (it is a fixed-size picture)', async () => {
    await panel();
    const walk = (n: { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }): { type?: unknown; props?: Record<string, unknown> }[] =>
      [...(n.type === 'Text' ? [n] : []), ...(n.children ?? []).flatMap((c) => (typeof c === 'string' ? [] : walk(c as never)))];
    const texts = walk(screen.getByTestId('share-card', { includeHiddenElements: true }) as never);
    expect(texts.length).toBeGreaterThan(8);
    expect(texts.every((t) => t.props?.allowFontScaling === false)).toBe(true);
  });
});

describe('what the card contains', () => {
  it('has the day, sets, volume, exercises, best sets and records, and none of the body weight, how a set felt or calories', async () => {
    const m = buildShareCard({ date: '2026-10-08', exs, cardio: null, lifts: { 'Barbell Bench Press': { pbToast: '2026-10-08' } as never } });
    expect(m.title).toBe('Thursday workout');
    expect(m.stats).toEqual([{ label: 'Sets', value: '3/3' }, { label: 'Volume (kg)', value: '1,215' }, { label: 'Exercises', value: '2' }]);
    expect(m.rows).toEqual([{ name: 'Barbell Bench Press', best: '62.5 x 6', pr: true }, { name: 'Pec Deck Fly', best: '30 x 12', pr: false }]);
    const all = JSON.stringify(m) + JSON.stringify(Object.keys(m));
    expect(all).not.toMatch(/83\.7|kcal|burn|Hard|Felt|weight|health/i);
    await panel();
    const texts = (n: { children: unknown[] }): string[] => n.children.flatMap((c) => (typeof c === 'string' ? [c] : texts(c as { children: unknown[] })));
    const drawn = texts(screen.getByTestId('share-card', { includeHiddenElements: true }) as never).join(' | ');
    expect(drawn).toContain('Barbell Bench Press');
    expect(drawn).toContain('62.5 x 6');
    expect(drawn).not.toMatch(/83\.7|kcal|Hard|Felt/i); // body weight 83.7, calories, how a set felt
  });

  it('keeps the fixed size: extra exercises become "+N more"', () => {
    const many = Array.from({ length: 10 }, (_, i) => ex(`Lift ${i}`, [row('10', '5', true)]));
    const m = buildShareCard({ date: '2026-10-08', exs: many, cardio: 20, lifts: {} });
    expect(m.rows).toHaveLength(7);
    expect(m.more).toBe(3);
    expect(m.stats.at(-1)).toEqual({ label: 'Cardio (min)', value: '20' });
    // Everything the card stacks fits its height, 4:5, so nothing is clipped (rows, "+N more", header and stats).
    expect(2 * CARD_PAD + HEADER_H + STATS_H + CARD_MAX_ROWS * ROW_H + MORE_H).toBeLessThanOrEqual(CARD_H);
    expect(CARD_W / CARD_H).toBeCloseTo(0.8);
  });

  it('the card stats are short: a 5-digit volume is 12.4k and labels fit a narrow box', () => {
    const heavy = [ex('Leg Press', [row('200', '60', true)])];
    const m = buildShareCard({ date: '2026-10-08', exs: heavy, cardio: 45, lifts: {} });
    expect(m.cardStats).toEqual([{ label: 'Sets', value: '1/1' }, { label: 'Volume kg', value: '12k' }, { label: 'Exercises', value: '1' }, { label: 'Cardio min', value: '45' }]);
    expect(m.stats[1]).toEqual({ label: 'Volume (kg)', value: '12,000' }); // the panel keeps the full figure
  });
});

describe('licences', () => {
  it('lists react-native-view-shot (MIT) in the About screen data', () => {
    const data = JSON.parse(readFileSync(join(__dirname, '../src/about/licences.json'), 'utf8')) as { packages: { name: string; licence: string }[] };
    expect(data.packages.find((p) => p.name === 'react-native-view-shot')?.licence).toBe('MIT');
  });
});
