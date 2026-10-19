import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored } from '../src/content/store';
import { AboutScreen } from '../src/about/AboutScreen';
import { ExerciseFigure } from '../src/workout/ExerciseFigure';
import { ALT_MAX, figureAlt, getFigureSources, isFigureBundle, themedSvg } from '../src/workout/figures';
import { getCatalog } from '../src/workout/catalog';
import { dark, light } from '../src/theme/tokens';
import { passesAllowlist } from '../src/workout/svgAllowlist';
import corpus from '../../../tools/validate/fixtures/svg-corpus.json';
import { exInfo, type Suggestion } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { blankRow, type ExState } from '../src/workout/model';
import { openDb } from './sync-helpers';

const mockPush = jest.fn();
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));

const BENCH = 'Barbell Bench Press';
const SQUAT = 'Goblet Squat';
const NONE = 'Lat Pulldown';
const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">${inner}</svg>`;
const BODY = svg('<circle cx="80" cy="20" r="10" fill="var(--fig-body)"/><path d="M80 30 L80 80" stroke="currentColor" stroke-width="4" fill="none"/><path d="M60 40 L100 40" stroke="var(--fig-arm)" fill="none"/><rect x="50" y="90" width="60" height="6" fill="var(--fig-eq)"/><circle cx="80" cy="60" r="5" fill="var(--fig-hl)"/>');
const entry = (slug: string, extra: Record<string, unknown> = {}) => ({
  frames: ['a', 'b'].map((x) => ({ file: `svg/${slug}-${x}.svg`, w: 160, h: 120, svg: BODY })),
  source: 'own_drawing', source_id: `rig-v1/${slug}`, licence: 'CC-BY-4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/',
  author: 'Plate & Bar authors', author_url: null, source_url: null, changes: null, alt: null, note: null, ...extra,
});
const fixture = (): Record<string, any> => ({
  schema_version: 1,
  images: { [BENCH]: entry('bench', { note: "Your gym's bench may look different" }), [SQUAT]: entry('squat', { alt: 'Goblet squat, hold the weight at your chest.' }) },
});

async function launch(bundle: unknown): Promise<void> {
  const db = await openDb();
  await putStored(db, { name: 'exercise-images', sha256: 'x', schema_version: BUNDLED['exercise-images']!.schema_version, updated_at: '2099-01-01T00:00:00Z', body: JSON.stringify(bundle) });
  await loadContent(db);
}
const scheme = (s: 'light' | 'dark') => { mockScheme = s; };
/** fill and stroke of every SVG node in the rendered tree. */
function colours(): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    for (const k of ['fill', 'stroke']) {
      const p = n.props?.[k];
      if (p && typeof p === 'object' && typeof p.payload === 'number') out.push(String(p.payload));
    }
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}

beforeEach(() => { mockPush.mockClear(); scheme('light'); });

describe('ExerciseFigure', () => {
  it('renders the shipped figure for an exercise the shipped bundle covers', async () => {
    await loadContent(await openDb());
    await render(<ExerciseFigure name={BENCH} />);
    expect(screen.getByRole('image').props.accessibilityLabel).toBe(`${BENCH}: start and end positions. ${getCatalog().cards[BENCH]!.setup[0]}`);
  });

  it('renders the pair as one labelled image with a credit link to About', async () => {
    await launch(fixture());
    await render(<ExerciseFigure name={BENCH} />);
    const img = screen.getByRole('image');
    expect(img.props.accessibilityLabel).toBe(`${BENCH}: start and end positions. ${getCatalog().cards[BENCH]!.setup[0]}`);
    expect(screen.getByText("Your gym's bench may look different")).toBeTruthy();
    expect(screen.getByText('Drawing: Plate & Bar authors (CC BY 4.0)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link'));
    expect(mockPush).toHaveBeenCalledWith('/about');
    expect(colours().length).toBeGreaterThan(0);
  });

  it('reads a one-frame figure as a held position and shows it once, with no toggle between frames', async () => {
    jest.useFakeTimers();
    try {
      const b = fixture();
      b.images[BENCH].frames = b.images[BENCH].frames.slice(0, 1);
      await launch(b);
      await render(<ExerciseFigure name={BENCH} />);
      const label = () => screen.getByRole('image').props.accessibilityLabel as string;
      expect(label()).toBe(`${BENCH}: held position. ${getCatalog().cards[BENCH]!.setup[0]}`);
      expect(label()).not.toContain('starting position');
      const before = JSON.stringify(screen.toJSON());
      await jest.advanceTimersByTimeAsync(10_000);
      expect(JSON.stringify(screen.toJSON())).toBe(before);
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('draws a one-frame figure at the width of one frame of a pair, centred', async () => {
    const ROW = 360;
    const GAP = 8;
    const widthOf = () => {
      const row = StyleSheet.flatten(screen.getByTestId('figure-row').props.style) ?? {};
      const pad = typeof row.paddingHorizontal === 'string' ? (parseFloat(row.paddingHorizontal) / 100) * ROW : (row.paddingHorizontal as number | undefined) ?? 0;
      const frames = screen.getAllByTestId('figure-frame', { hidden: true });
      const f = StyleSheet.flatten(frames[0]!.props.style) ?? {};
      const margin = (f.marginHorizontal as number | undefined) ?? 0;
      return (ROW - 2 * pad - (frames.length - 1) * GAP) / frames.length - 2 * margin;
    };
    await launch(fixture());
    const pair = await render(<ExerciseFigure name={BENCH} />);
    const perFrame = widthOf();
    expect(StyleSheet.flatten(screen.getByTestId('figure-row').props.style).gap).toBe(GAP);
    pair.unmount();
    const b = fixture();
    b.images[BENCH].frames = b.images[BENCH].frames.slice(0, 1);
    await launch(b);
    await render(<ExerciseFigure name={BENCH} />);
    expect(widthOf()).toBe(perFrame);
    expect(StyleSheet.flatten(screen.getByTestId('figure-row').props.style).flexDirection).toBe('row');
  });

  it('keeps start and end wording for a two-frame figure', async () => {
    await launch(fixture());
    await render(<ExerciseFigure name={BENCH} />);
    expect(screen.getByRole('image').props.accessibilityLabel).toContain('start and end positions.');
    expect(screen.getByRole('image').props.accessibilityLabel).not.toContain('held position');
  });

  it('renders nothing for an exercise with no figure', async () => {
    await launch(fixture());
    await render(<ExerciseFigure name={NONE} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('uses the alt override', async () => {
    await launch(fixture());
    await render(<ExerciseFigure name={SQUAT} />);
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Goblet squat, hold the weight at your chest.');
  });

  it('draws with theme colours, different in light and dark, and no CSS variables or currentColor reach the renderer', async () => {
    await launch(fixture());
    const light1 = await render(<ExerciseFigure name={BENCH} />);
    const lightColours = colours();
    await light1.unmount();
    scheme('dark');
    await render(<ExerciseFigure name={BENCH} />);
    const darkColours = colours();
    expect(lightColours).not.toEqual(darkColours);
    const joined = JSON.stringify(screen.toJSON());
    expect(joined).not.toMatch(/--fig-|currentColor/);
  });

  it('refuses a stored copy with unsafe SVG and falls back to the shipped figure', async () => {
    const bad = fixture();
    bad.images[SQUAT].frames[0].svg = svg('<script>alert(1)</script><circle r="4" fill="var(--fig-body)"/>');
    await launch(bad);
    await render(<ExerciseFigure name={BENCH} />);
    // The whole stored copy is refused, so the shipped bench press figure shows and the fixture's note does not.
    expect(screen.getByRole('image')).toBeTruthy();
    expect(screen.queryByText("Your gym's bench may look different")).toBeNull();
  });
});

describe('themedSvg', () => {
  it('maps every token and currentColor to palette colours, light and dark', () => {
    const l = themedSvg(BODY, light);
    expect(l).toContain(`fill="${light.ink}"`);
    expect(l).toContain(`stroke="${light.body}"`);
    expect(l).toContain(`fill="${light.fat}"`);
    expect(l).toContain(`fill="${light.muted}"`);
    expect(l).not.toMatch(/var\(|currentColor/);
    expect(themedSvg(BODY, dark)).toContain(`fill="${dark.ink}"`);
    expect(themedSvg(BODY, dark)).not.toEqual(l);
  });
});

describe('figureAlt', () => {
  const e = (frames: number) => ({ alt: null, frames: Array.from({ length: frames }, () => ({}) as never) });
  it('cuts the first setup step at a sentence boundary under the limit', () => {
    const s = 'Set the seat so the handles line up with the middle of your chest. Then sit back and plant your feet flat on the floor, keeping your shoulder blades pulled together.';
    const out = figureAlt('Machine Chest Press', e(2), s);
    expect(out).toBe('Machine Chest Press: start and end positions. Set the seat so the handles line up with the middle of your chest.');
    expect(out.length).toBeLessThanOrEqual(ALT_MAX);
  });
  it('drops the step when even its first sentence is too long, and handles a missing step and one frame', () => {
    expect(figureAlt('X', e(2), `${'long '.repeat(40)}.`)).toBe('X: start and end positions.');
    expect(figureAlt('X', e(1), undefined)).toBe('X: held position.');
  });
  it('every shipped card gives a non-empty alt under the limit', () => {
    for (const [n, c] of Object.entries(getCatalog().cards)) {
      const out = figureAlt(n, e(2), c.setup[0]);
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(ALT_MAX);
    }
  });
});

describe('isFigureBundle', () => {
  const frame = (inner: string) => (b: Record<string, any>) => { b.images[BENCH].frames[0].svg = svg(inner); };
  // The first block is the #960 review's bypass samples (each passed that PR's denylist); the rest are other ways in.
  const unsafe: [string, (b: Record<string, any>) => void][] = [
    ['a slash before an attribute (onclick)', frame('<circle cx="1"/onclick="alert(1)"/>')],
    ['an img with a slash-onerror', frame('<img src="x"/onerror="alert(1)">')],
    ['an external img', frame('<img src="https://evil.example/t.gif">')],
    ['an embed', frame('<embed src="https://evil.example/x">')],
    ['a meta refresh', frame('<meta http-equiv="refresh" content="0;url=https://evil.example">')],
    ['a prefixed script', frame('<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>')],
    ['a prefixed foreignObject', frame('<x:foreignObject xmlns:x="http://www.w3.org/2000/svg"></x:foreignObject>')],
    ['an external filter url', frame('<circle r="1" filter="url(https://evil.example/f.svg#f)"/>')],
    ['a data: mask url', frame('<circle r="1" mask="url(data:image/svg+xml;base64,AAAA)"/>')],
    ['a slash before style', frame('<circle r="1"/style="fill:red"/>')],
    ['animateTransform', frame('<animateTransform attributeName="transform" type="rotate" from="0" to="360"/>')],
    ['animateMotion', frame('<animateMotion path="M0 0"/>')],
    ['a single-quoted colour', frame("<circle r=\"1\" fill='#ff0000'/>")],
    ['spaces around = in a colour', frame('<circle r="1" fill = "red"/>')],
    ['an unquoted colour', frame('<circle r="1" fill=red/>')],
    ['flood-color on a filter element', frame('<feFlood flood-color="red"/>')],
    ['a baked-in colour', frame('<circle r="4" fill="#ff0000"/>')],
    ['an event handler', frame('<circle r="4" onload="x()" fill="none"/>')],
    ['a script element', frame('<script>alert(1)</script>')],
    ['a link', frame('<a href="https://x.test"><circle r="4"/></a>')],
    ['an embedded image element', frame('<image width="4" height="4"/>')],
    ['a style attribute', frame('<circle r="4" style="fill:red"/>')],
    ['a style element', frame('<style>circle{fill:red}</style>')],
    ['a use element', frame('<use x="1"/>')],
    ['a polygon (not on the list)', frame('<polygon points="0,0 1,1 2,0"/>')],
    ['a non-numeric geometry value', frame('<circle r="1em"/>')],
    ['a url() paint', frame('<circle r="4" fill="url(#g)"/>')],
    ['a javascript: value', frame('<circle r="4" transform="javascript:alert(1)"/>')],
    ['text between tags', frame('<g>hello</g>')],
    ['a comment', frame('<!-- x --><circle r="4"/>')],
    ['a DOCTYPE entity', frame('<!DOCTYPE svg [<!ENTITY x "y">]><circle r="4"/>')],
    ['an attribute not on the list', frame('<circle r="4" id="a"/>')],
    ['a duplicate attribute', frame('<circle r="4" r="5"/>')],
    ['a second root', (b) => { b.images[BENCH].frames[0].svg = `${BODY}${BODY}`; }],
    ['an unclosed element', frame('<g><circle r="4"/>')],
    ['mismatched tags', frame('<g><circle r="4"/></path>')],
    ['a nested svg', frame('<svg><circle r="4"/></svg>')],
    ['a viewBox only in a comment', (b) => { b.images[BENCH].frames[0].svg = '<!-- viewBox="0 0 160 120" --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>'; }],
    ['a wrong viewBox', (b) => { b.images[BENCH].frames[0].w = 200; }],
    ['a foreign xmlns on the root', (b) => { b.images[BENCH].frames[0].svg = BODY.replace('http://www.w3.org/2000/svg', 'http://evil.example/'); }],
    ['an oversize frame', frame(`<g>${'<circle r="1"/>'.repeat(600)}</g>`)],
    ['three frames', (b) => { b.images[BENCH].frames.push(b.images[BENCH].frames[0]); }],
    ['a third-party source', (b) => { b.images[BENCH].source = 'wger'; }],
    ['a licence off the allowlist', (b) => { b.images[BENCH].licence = 'CC-BY-SA-3.0'; }],
    ['another licence link', (b) => { b.images[BENCH].licence_url = 'https://evil.example/'; }],
    ['a blank alt', (b) => { b.images[BENCH].alt = ' '; }],
    ['a missing field (note)', (b) => { delete b.images[BENCH].note; }],
    ['an unknown field', (b) => { b.images[BENCH].generated = true; }],
    ['a key that is not an exercise', (b) => { b.images['Not An Exercise'] = entry('nope'); }],
    ['an empty author', (b) => { b.images[BENCH].author = ' '; }],
    ['a non-https credit link', (b) => { b.images[BENCH].author_url = 'http://x.test'; }],
    ['a prototype-named key', (b) => { b.images.constructor = entry('c'); }],
  ];
  it('accepts the fixture and an empty bundle', () => {
    expect(isFigureBundle(fixture())).toBe(true);
    expect(isFigureBundle({ schema_version: 1, images: {} })).toBe(true);
  });
  it.each(unsafe)('refuses %s', (_n, mutate) => {
    const b = fixture();
    mutate(b);
    expect(isFigureBundle(b)).toBe(false);
  });
});

describe('About: Exercise drawings', () => {
  it('shows nothing with an empty bundle', async () => {
    await launch({ schema_version: 1, images: {} });
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.queryByText('Exercise drawings')).toBeNull();
  });

  it('lists the shipped drawings when nothing is stored', async () => {
    await loadContent(await openDb());
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Exercise drawings')).toBeTruthy();
    expect(screen.getByText(/^Plate & Bar authors: \d+ exercise drawings$/)).toBeTruthy();
  });

  it('lists one row per author and licence with the exercise count and licence link', async () => {
    await launch(fixture());
    expect(getFigureSources()).toEqual([expect.objectContaining({ author: 'Plate & Bar authors', licence: 'CC-BY-4.0', count: 2 })]);
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Exercise drawings')).toBeTruthy();
    expect(screen.getByText('Plate & Bar authors: 2 exercise drawings')).toBeTruthy();
    expect(screen.getByText('Licence: CC BY 4.0')).toBeTruthy();
    expect(screen.getByText('https://creativecommons.org/licenses/by/4.0/')).toBeTruthy();
  });
});

describe('SVG allowlist parity with tools/validate/svg-allowlist.mjs', () => {
  // The same corpus is run by tools/test/exercise-images.test.mjs; both must give each entry's expected verdict.
  const frames = corpus as { name: string; w: number; h: number; ok: boolean; svg: string }[];
  it('has both accepted and refused entries', () => {
    expect(frames.length).toBeGreaterThanOrEqual(100);
    expect(frames.some((f) => f.ok) && frames.some((f) => !f.ok)).toBe(true);
  });
  it.each(frames.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    expect(passesAllowlist(f.svg, f.w, f.h)).toBe(f.ok);
  });
});

describe('Learn block figure', () => {
  const SUG: Suggestion = { mode: 'hold', reps: 8, w: 40, text: '40 kg × 8 reps', reason: 'Same again.' };
  const act = new Proxy({}, { get: () => jest.fn() }) as Actions;
  function card(done: number) {
    const sets = Array.from({ length: 3 }, (_, j) => ({ ...blankRow(), w: '40', r: '8', done: j < done }));
    const ex: ExState = { name: BENCH, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets };
    return <ExerciseCard ex={ex} info={exInfo(BENCH, getCatalog())} sug={SUG} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} learning prior={0} />;
  }
  it('shows on the first set and is gone once a set is done', async () => {
    await launch(fixture());
    const r = await render(card(0));
    expect(screen.getByText('Learn mode')).toBeTruthy();
    expect(screen.getByRole('image')).toBeTruthy();
    await r.rerender(card(1));
    expect(screen.getByText('Learn mode')).toBeTruthy();
    expect(screen.queryByRole('image')).toBeNull();
  });
});
