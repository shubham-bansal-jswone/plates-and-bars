import { StyleSheet, View } from 'react-native';
import Svg, { G, Polygon, Text as SvgText } from 'react-native-svg';
import { Text } from '../components/Text';
import { useFontFamily } from '../theme/fonts';
import { useTheme } from '../theme/useTheme';
import { REGIONS } from './bodyMapData';
import { listJoin, muscleName } from './copy';

// Prototype `MAP_FRONT` and `MAP_BACK`: which drawn regions each muscle lights up.
const FRONT: Record<string, string[]> = { chest: ['CHEST'], 'front-delt': ['FRONT_DELTOIDS'], 'side-delt': ['FRONT_DELTOIDS'], biceps: ['BICEPS'], triceps: ['TRICEPS'], forearms: ['FOREARM'], abs: ['ABS', 'OBLIQUES'], quads: ['QUADRICEPS'], calves: ['CALVES'] };
const BACK: Record<string, string[]> = { 'upper-back': ['TRAPEZIUS'], lats: ['UPPER_BACK'], 'rear-delt': ['BACK_DELTOIDS'], 'side-delt': ['BACK_DELTOIDS'], triceps: ['TRICEPS'], forearms: ['FOREARM'], 'lower-back': ['LOWER_BACK'], glutes: ['GLUTEAL', 'ABDUCTOR'], hams: ['HAMSTRING'], calves: ['CALVES', 'LEFT_SOLEUS', 'RIGHT_SOLEUS'] };

/** Region name to 2 (main), 1 (also working) or 0 for one view. A region two muscles share takes the stronger. */
function shades(map: Record<string, string[]>, primary: readonly string[], secondary: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [m, regions] of Object.entries(map)) {
    const v = primary.includes(m) ? 2 : secondary.includes(m) ? 1 : 0;
    for (const r of regions) out.set(r, Math.max(out.get(r) ?? 0, v));
  }
  return out;
}

/** The front and back muscle map (`bodyMapSvg`): main muscles in the brand colour, also-working in `muscleAlso`, the rest in `muscleOff`. */
export function BodyMap({ primary, secondary }: { primary: readonly string[]; secondary: readonly string[] }) {
  const c = useTheme();
  const fontFamily = useFontFamily()('400');
  const also = c.muscleAlso;
  const fill = (v: number) => (v === 2 ? c.brand : v === 1 ? also : c.muscleOff);
  const label = `Muscles worked: ${primary.length ? listJoin(primary.map(muscleName)) : 'none'}${secondary.length ? `. Also working: ${listJoin(secondary.map(muscleName))}` : ''}`;
  const views = [
    { view: 'front', map: FRONT, dx: 0, name: 'Front' },
    { view: 'back', map: BACK, dx: 110, name: 'Back' },
  ] as const;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.wrap}>
      <Svg width="100%" viewBox="0 0 210 222" style={styles.svg}>
        {views.map(({ view, map, dx, name }) => {
          const state = shades(map, primary, secondary);
          return (
            <G key={view} transform={`translate(${dx} 0)`}>
              {REGIONS[view].map(([region, polygons]) => polygons.map((points, i) => <Polygon key={`${region}${i}`} points={points} fill={fill(state.get(region) ?? 0)} />))}
              <SvgText x={50} y={216} textAnchor="middle" fontSize={12} fill={c.muted} fontFamily={fontFamily}>
                {name}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      <View style={styles.legend}>
        <View style={styles.key}>
          <View style={[styles.swatch, { backgroundColor: c.brand }]} />
          <Text style={{ color: c.muted, fontSize: 13 }}>Main focus</Text>
        </View>
        <View style={styles.key}>
          <View style={[styles.swatch, { backgroundColor: also }]} />
          <Text style={{ color: c.muted, fontSize: 13 }}>Also working</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  svg: { aspectRatio: 210 / 222, maxHeight: 240 },
  legend: { flexDirection: 'row', gap: 16 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
});
