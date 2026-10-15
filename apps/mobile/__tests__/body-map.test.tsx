import { render, screen } from '@testing-library/react-native';
import { BodyMap } from '../src/workout/BodyMap';
import { REGIONS } from '../src/workout/bodyMapData';
import { light } from '../src/theme/tokens';

interface Node {
  type?: string;
  props?: { d?: string; fill?: { payload: number } };
  children?: Node[] | null;
}
const argb = (hex: string) => (0xff000000 + parseInt(hex.slice(1), 16)) >>> 0;
const REGION_OF = new Map<string, string>(Object.values(REGIONS).flatMap((list) => list.flatMap(([region, polys]) => polys.map((p) => [`M${p}z`, region] as [string, string]))));

/** Region name to the set of fills its polygons were drawn with. */
function drawn(): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const walk = (n: Node | null | undefined) => {
    if (!n) return;
    if (n.type === 'RNSVGPath' && n.props?.d) {
      const region = REGION_OF.get(n.props.d)!;
      expect(region).toBeDefined();
      out.set(region, (out.get(region) ?? new Set()).add(n.props.fill!.payload));
    }
    n.children?.forEach(walk);
  };
  walk(screen.toJSON() as Node);
  return out;
}
const regionsWith = (fill: string) => [...drawn()].filter(([, f]) => f.has(argb(fill))).map(([r]) => r).sort();

describe('BodyMap', () => {
  it('draws main muscles in the fat colour, also-working in the carbs colour and the rest in the line colour', async () => {
    await render(<BodyMap primary={['chest']} secondary={['triceps']} />);
    const d = drawn();
    expect(d.get('CHEST')).toEqual(new Set([argb(light.fat)]));
    expect(d.get('TRICEPS')).toEqual(new Set([argb(light.carbs)]));
    expect(d.get('ABS')).toEqual(new Set([argb(light.line)]));
    expect(regionsWith(light.fat)).toEqual(['CHEST']);
    expect(regionsWith(light.carbs)).toEqual(['TRICEPS']);
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
    expect(regionsWith(light.fat)).toEqual(regions);
  });

  it('a muscle that is both main and also-working shows as main', async () => {
    await render(<BodyMap primary={['chest']} secondary={['chest']} />);
    expect(regionsWith(light.fat)).toEqual(['CHEST']);
    expect(regionsWith(light.carbs)).toEqual([]);
  });

  it('speaks the also-working muscles as well as the main ones', async () => {
    await render(<BodyMap primary={['chest', 'triceps']} secondary={['front-delt']} />);
    expect(screen.getByLabelText('Muscles worked: chest and triceps. Also working: front shoulders')).toBeTruthy();
  });
});
