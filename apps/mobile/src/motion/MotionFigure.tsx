import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Line } from 'react-native-svg';
import { Text } from '../components/Text';
import { Press } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from '../workout/catalog';
import { figureColours } from '../workout/figures';
import { motionAlt, motionCredit, type MotionEntry } from './data';
import { RIG_SEG, keyFrameIndex, motionDuration, rigJoints, sampleFrame, type Frame } from './project';

// Drawing space and limb widths of the v1.1 rig (tools/exercise-figures/rig.mjs: 320 x 240, W, the floor line at y 226).
const W = 320;
const H = 240;
const WIDTH = { foot: 7, sh: 12, th: 17, torso: 26, ua: 11, fa: 9 } as const;
/** Redraws per second. The pose is computed from the clock, so a slow device skips frames instead of slowing the motion down. */
const TICK_FPS = 15;

/** True while the system asks for reduced motion. Until the system has answered it counts as true, so nothing moves first. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(v); }, () => { if (alive) setReduced(true); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

/** True while the app is in the foreground. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

function Pose({ frame, colours }: { frame: Frame; colours: ReturnType<typeof figureColours> }) {
  const J = rigJoints(frame);
  const seg = (a: readonly number[], b: readonly number[], w: number, c: string, k: string) => (
    <Line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
      <Line x1={60} y1={226} x2={260} y2={226} stroke={colours.eq} strokeWidth={2} />
      {seg(J.ankle, J.toe, WIDTH.foot, colours.body, 'foot')}
      {seg(J.ankle, J.knee, WIDTH.sh, colours.body, 'shin')}
      {seg(J.knee, J.hip, WIDTH.th, colours.body, 'thigh')}
      {seg(J.hip, J.sh, WIDTH.torso, colours.body, 'torso')}
      <Circle cx={J.head[0]} cy={J.head[1]} r={RIG_SEG.head} fill={colours.bg} stroke={colours.body} strokeWidth={5} />
      {seg(J.sh, J.el, WIDTH.ua, colours.arm, 'upper-arm')}
      {seg(J.el, J.wr, WIDTH.fa, colours.arm, 'forearm')}
    </Svg>
  );
}

/**
 * A looping side-view motion of an exercise (content/exercise-motion.json) drawn with the v1.1 rig's proportions. Under reduced motion it
 * shows one static key pose and runs no timer. It pauses when the app is in the background. One image element carries the alt text.
 */
export function MotionFigure({ name, entry }: { name: string; entry: MotionEntry }) {
  const c = useTheme();
  const router = useRouter();
  const reduced = useReducedMotion();
  const active = useAppActive();
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const at = useRef(0);
  const running = !reduced && active && !paused;
  useEffect(() => {
    if (!running) return;
    const base = Date.now() - at.current * 1000;
    const id = setInterval(() => {
      at.current = (Date.now() - base) / 1000;
      setElapsed(at.current);
    }, 1000 / TICK_FPS);
    return () => clearInterval(id);
  }, [running]);
  const frame = reduced ? entry.frames[keyFrameIndex(entry)]! : sampleFrame(entry, elapsed % motionDuration(entry));
  const alt = motionAlt(name, reduced, getCatalog().cards[name]?.setup[0]);
  // The visible text starts the accessible name, so axe's label-content-name-mismatch rule holds.
  const credit = motionCredit(entry);
  return (
    <View style={{ gap: 4 }}>
      <View accessible accessibilityRole="image" accessibilityLabel={alt} testID="motion-figure" style={[styles.frame, { backgroundColor: c.tint, borderColor: c.line }]}>
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <Pose frame={frame} colours={figureColours(c)} />
        </View>
      </View>
      {entry.note ? <Text style={[type.caption, { color: c.body }]}>{entry.note}</Text> : null}
      {reduced ? null : (
        <Press
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Play animation' : 'Pause animation'}
          onPress={() => setPaused((p) => !p)}
          style={styles.control}
        >
          <Text style={[type.small, { color: c.link }]}>{paused ? 'Play' : 'Pause'}</Text>
        </Press>
      )}
      <Press accessibilityRole="link" accessibilityLabel={`${credit}. Opens About and sources`} onPress={() => router.push('/about' as never)} style={styles.control}>
        <Text style={[type.small, { color: c.link }]}>{credit}</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  // One frame wide like a lone v1.1 frame (an isometric hold): half the row, centred.
  frame: { alignSelf: 'center', width: '50%', aspectRatio: W / H, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  control: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
