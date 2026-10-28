import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Circle, G, Line } from 'react-native-svg';
import { Text } from '../components/Text';
import { useReducedMotion } from '../components/reducedMotion';
import { Press } from '../components/ui';
import { linkText, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from '../workout/catalog';
import { figureColours } from '../workout/figures';
import { motionAlt, motionCredit, type MotionEntry } from './data';
import { FLOOR_Y, FRAME_H as H, FRAME_W as W, HEAD_STROKE, RIG_SEG, WIDTH, fitClip, keyFrameIndex, motionDuration, rigPose, sampleFrame, type FitTransform, type RigJoints } from './project';

/** Redraws per second. The pose is computed from the clock, so a slow device skips frames instead of slowing the motion down. */
const TICK_FPS = 15;

/** True while this screen has focus (a tab or stack screen that is covered keeps its components mounted, so they must stop themselves). */
function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
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

function Pose({ J, fit, colours }: { J: RigJoints; fit: FitTransform; colours: ReturnType<typeof figureColours> }) {
  const seg = (a: readonly number[], b: readonly number[], w: number, c: string, k: string) => (
    <Line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
      <G transform={`translate(${fit.tx} ${fit.ty}) scale(${fit.scale})`}>
      <Line x1={fit.floor[0]} y1={FLOOR_Y} x2={fit.floor[1]} y2={FLOOR_Y} stroke={colours.eq} strokeWidth={2} />
      {seg(J.ankle, J.toe, WIDTH.foot, colours.body, 'foot')}
      {seg(J.ankle, J.knee, WIDTH.sh, colours.body, 'shin')}
      {seg(J.knee, J.hip, WIDTH.th, colours.body, 'thigh')}
      {seg(J.hip, J.sh, WIDTH.torso, colours.body, 'torso')}
      <Circle cx={J.head[0]} cy={J.head[1]} r={RIG_SEG.head} fill={colours.bg} stroke={colours.body} strokeWidth={HEAD_STROKE} />
      {seg(J.sh, J.el, WIDTH.ua, colours.arm, 'upper-arm')}
      {seg(J.el, J.wr, WIDTH.fa, colours.arm, 'forearm')}
      </G>
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
  const answer = useReducedMotion();
  const reduced = answer === true;
  const active = useAppActive();
  const focused = useScreenFocused();
  const [paused, setPaused] = useState(false);
  // The drawn pose with the directions it used: the next pose reads them, so a segment that turns end-on holds still (project.ts).
  const [pose, setPose] = useState(() => rigPose(entry.frames[0]!));
  const at = useRef(0);
  // Plays only once the system said no reduced motion, in the foreground, on a focused screen. (Cards scrolled out of view inside a focused screen keep
  // playing: tracking that needs scroll or viewport plumbing, so focus is the pause signal here.)
  const running = answer === false && active && focused && !paused;
  useEffect(() => {
    if (!running) return;
    const base = Date.now() - at.current * 1000;
    const id = setInterval(() => {
      at.current = (Date.now() - base) / 1000;
      const t = at.current % motionDuration(entry);
      setPose((p) => rigPose(sampleFrame(entry, t), p.dirs));
    }, 1000 / TICK_FPS);
    return () => clearInterval(id);
  }, [running, entry]);
  // One transform for the whole clip (every frame), so the figure neither rescales nor jumps while it plays.
  const fit = useMemo(() => fitClip(entry), [entry]);
  const keyPose = useMemo(() => rigPose(entry.frames[keyFrameIndex(entry)]!), [entry]);
  const alt = useMemo(() => motionAlt(name, reduced, getCatalog().cards[name]?.setup[0]), [name, reduced]);
  const colours = useMemo(() => figureColours(c), [c]);
  // The visible text starts the accessible name, so axe's label-content-name-mismatch rule holds.
  const credit = motionCredit(entry);
  return (
    <View style={{ gap: 4 }}>
      <View accessible accessibilityRole="image" accessibilityLabel={alt} testID="motion-figure" style={[styles.frame, { backgroundColor: c.tint, borderColor: c.line }]}>
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <Pose J={(reduced ? keyPose : pose).joints} fit={fit} colours={colours} />
        </View>
      </View>
      {entry.note ? <Text style={[type.caption, { color: c.body }]}>{entry.note}</Text> : null}
      {answer === false ? (
        <Press
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Play animation' : 'Pause animation'}
          onPress={() => setPaused((p) => !p)}
          style={styles.control}
        >
          <Text style={[type.small, linkText, { color: c.link }]}>{paused ? 'Play' : 'Pause'}</Text>
        </Press>
      ) : null}
      <Press accessibilityRole="link" accessibilityLabel={`${credit}. Opens About and sources`} onPress={() => router.push('/about' as never)} style={styles.control}>
        <Text style={[type.small, linkText, { color: c.link }]}>{credit}</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  // One frame wide like a lone v1.1 frame (an isometric hold): half the row, centred.
  frame: { alignSelf: 'center', width: '50%', aspectRatio: W / H, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  control: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
