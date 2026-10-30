import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ResultsView } from '../src/components/ResultsView';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { buildResults } from '../src/setup/results';
import { withProfile, memoryDb } from './helpers';
import { WeightUnitProvider } from '../src/settings/weightUnit';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

type Node = { type?: string; props?: Record<string, unknown>; children?: (Node | string)[] | null };
const texts = (n: Node | string | null | undefined): string => (typeof n === 'string' ? n : !n ? '' : (n.children ?? []).map(texts).join('|'));
/** The two columns: the row whose style has a 24px gap. */
function columns(n: Node | string | null | undefined): Node[] | null {
  if (!n || typeof n === 'string') return null;
  const st = ([] as Record<string, unknown>[]).concat(n.props?.style as never).flat(3).filter(Boolean).reduce((a, b) => ({ ...a, ...b }), {});
  if (st.flexDirection === 'row' && st.gap === 24) return (n.children ?? []).filter((x): x is Node => typeof x !== 'string');
  for (const c of n.children ?? []) { const f = columns(c); if (f) return f; }
  return null;
}

function mount(width: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- spy on the module object the screen reads from
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
  const db = memoryDb();
  return render(withProfile(db, <WeightUnitProvider db={db}><ResultsView profile={profile} showWhy columns footer={<Text>FOOTER</Text>} /></WeightUnitProvider>));
}

describe('ResultsView two columns (#1409)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('at 1280 the targets sit on the right with what explains them under them, and the footer ends that column', async () => {
    await mount(1280);
    const [left, right] = columns(screen.toJSON() as Node) ?? [];
    const pace = buildResults(profile, 'kg').pace;
    expect(texts(left)).toContain(buildResults(profile, 'kg').rows[0]![0]);
    expect(texts(left)).not.toContain('Your daily targets');
    expect(texts(left)).not.toContain(pace);
    const r = texts(right);
    expect(r.indexOf('Your daily targets')).toBeGreaterThanOrEqual(0);
    expect(r.indexOf(pace)).toBeGreaterThan(r.indexOf('Your daily targets'));
    expect(r.indexOf('Why these numbers?')).toBeGreaterThan(r.indexOf(pace));
    expect(r.endsWith('FOOTER')).toBe(true);
  });

  it('stacked at 430 it reads breakdown, targets, explanation, then the footer', async () => {
    await mount(430);
    expect(columns(screen.toJSON() as Node)).toBeNull();
    const all = texts(screen.toJSON() as unknown as Node);
    const v = buildResults(profile, 'kg');
    expect(all.indexOf(v.rows[0]![0])).toBeLessThan(all.indexOf('Your daily targets'));
    expect(all.indexOf('Your daily targets')).toBeLessThan(all.indexOf(v.pace));
    expect(all.endsWith('FOOTER')).toBe(true);
  });
});
