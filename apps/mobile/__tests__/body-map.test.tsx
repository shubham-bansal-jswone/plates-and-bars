import { render, screen } from '@testing-library/react-native';
import { BodyMap } from '../src/workout/BodyMap';
import { REGIONS } from '../src/workout/bodyMapData';
import { light } from '../src/theme/tokens';

interface Node {
  type?: string;
  props?: { d?: string; fill?: { payload: number }; stroke?: { payload: number } };
  children?: Node[] | null;
}
const argb = (hex: string) => (0xff000000 + parseInt(hex.slice(1), 16)) >>> 0;
const also = light.muscleAlso;
const REGION_OF = new Map<string, string>(Object.values(REGIONS).flatMap((list) => list.flatMap(([region, polys]) => polys.map((p) => [`M${p}z`, region] as [string, string]))));

/** Region name to the set of fills its polygons were drawn with. */
function drawn(): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const walk = (n: Node | null | undefined) => {
    if (!n) return;
    if (n.type === 'RNSVGPath' && n.props?.d) {
      const region = REGION_OF.get(n.props.d)!;
      expect(region).toBeDefined();
      // A pattern fill (the also-working hatch overlay) has no colour payload; it is checked in the hatch test.
      if (typeof n.props.fill!.payload === 'number') out.set(region, (out.get(region) ?? new Set()).add(n.props.fill!.payload));
    }
    n.children?.forEach(walk);
  };
  walk(screen.toJSON() as Node);
  return out;
}
const regionsWith = (fill: string) => [...drawn()].filter(([, f]) => f.has(argb(fill))).map(([r]) => r).sort();

describe('BodyMap', () => {
  /** Every node of the rendered tree, flattened. */
  const nodes = (): Node[] => {
    const out: Node[] = [];
    const walk = (n: Node | null | undefined) => {
      if (!n) return;
      out.push(n);
      n.children?.forEach(walk);
    };
    walk(screen.toJSON() as Node);
    return out;
  };
  const refOf = (n: Node) => (n.props as { fill?: { brushRef?: string } } | undefined)?.fill?.brushRef;
  const patternNames = () => nodes().filter((n) => n.type === 'RNSVGPattern').map((n) => (n.props as { name: string }).name);

  it('hatches the also-working muscles and their legend key, so the distinction is not colour alone', async () => {
    await render(<BodyMap primary={['chest']} secondary={['triceps']} />);
    const [hatch, key] = patternNames();
    expect(patternNames()).toHaveLength(2);
    const hatched = nodes().filter((n) => n.type === 'RNSVGPath' && n.props?.d && refOf(n) === hatch);
    expect([...new Set(hatched.map((n) => REGION_OF.get(n.props!.d!)))]).toEqual(['TRICEPS']);
    // The legend swatch is filled with its pattern, not just carrying an id.
    expect(nodes().filter((n) => n.type === 'RNSVGRect' && refOf(n) === key)).toHaveLength(1);
  });

  it('gives each map its own pattern ids (they are document-global on web), and each references its own', async () => {
    await render(
      <>
        <BodyMap primary={['chest']} secondary={['triceps']} />
        <BodyMap primary={['quads']} secondary={['calves']} />
      </>,
    );
    const names = patternNames();
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
    const refs = nodes().map(refOf).filter(Boolean);
    expect(new Set(refs)).toEqual(new Set(names));
    expect(names.every((n) => /^[A-Za-z0-9-]+$/.test(n))).toBe(true);
  });

  it('draws main muscles in the brand colour, also-working in the stronger tint and the rest in the soft surface colour', async () => {
    await render(<BodyMap primary={['chest']} secondary={['triceps']} />);
    const d = drawn();
    expect(d.get('CHEST')).toEqual(new Set([argb(light.brand)]));
    expect(d.get('TRICEPS')).toEqual(new Set([argb(also)]));
    expect(d.get('ABS')).toEqual(new Set([argb(light.surfaceSoft)]));
    expect(regionsWith(light.brand)).toEqual(['CHEST']);
    expect(regionsWith(also)).toEqual(['TRICEPS']);
  });

  it('strokes every polygon with the muscleOff colour so the silhouette shows', async () => {
    await render(<BodyMap primary={['chest']} secondary={['triceps']} />);
    const strokes = new Set<number | undefined>();
    let paths = 0;
    const walk = (n: Node | null | undefined) => {
      if (!n) return;
      if (n.type === 'RNSVGPath' && n.props?.d) {
        paths += 1;
        strokes.add(n.props.stroke?.payload);
      }
      n.children?.forEach(walk);
    };
    walk(screen.toJSON() as Node);
    expect(paths).toBeGreaterThan(0);
    expect(strokes).toEqual(new Set([argb(light.muscleOff)]));
  });

  it.each([
    ['chest', ['CHEST']],
    ['front-delt', ['FRONT_DELTOIDS']],
    ['side-delt', ['BACK_DELTOIDS', 'FRONT_DELTOIDS']],
    ['rear-delt', ['BACK_DELTOIDS']],
    ['abs', ['ABS', 'OBLIQUES']],
    ['lats', ['UPPER_BACK']],
    ['upper-back', ['TRAPEZIUS']],
    ['lower-back', ['LOWER_BACK']],
    ['glutes', ['ABDUCTOR', 'GLUTEAL']],
    ['hams', ['HAMSTRING']],
    ['quads', ['QUADRICEPS']],
    ['calves', ['CALVES', 'LEFT_SOLEUS', 'RIGHT_SOLEUS']],
    ['biceps', ['BICEPS']],
    ['triceps', ['TRICEPS']],
    ['forearms', ['FOREARM']],
  ])('lights up the right regions for %s', async (muscle, regions) => {
    await render(<BodyMap primary={[muscle]} secondary={[]} />);
    expect(regionsWith(light.brand)).toEqual(regions);
  });

  it('a muscle that is both main and also-working shows as main', async () => {
    await render(<BodyMap primary={['chest']} secondary={['chest']} />);
    expect(regionsWith(light.brand)).toEqual(['CHEST']);
    expect(regionsWith(also)).toEqual([]);
  });

  it('speaks the also-working muscles as well as the main ones', async () => {
    await render(<BodyMap primary={['chest', 'triceps']} secondary={['front-delt']} />);
    expect(screen.getByLabelText('Muscles worked: chest and triceps. Also working: front shoulders')).toBeTruthy();
  });
});
