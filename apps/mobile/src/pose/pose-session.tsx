// The camera view of "Track this set" (#947). Loaded by `import()` only when the sheet opens (the name `pose-` keeps the
// service worker from precaching it). Frames go camera -> model -> core's rep counter and are dropped: nothing is written
// to disk, sent anywhere or kept after the set. Only the rep numbers survive, and only if the user applies them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { DEPTH_CUES, initRepCounter, repInProgress, squatSignal, stepRepCounter, type PoseExercise, type RepCounterState, type SquatRep } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Hint, Note } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { PoseCameraView } from '../../modules/plate-pose';
import { POSE_COPY as t } from './copy';
import { createNativePoseDetector, openNativeCamera } from './pose-native';
import type { CameraStream, PoseDetector } from './types';

/** About 10 frames a second is plenty for reps that last 2 to 4 seconds, and keeps a low-end device cool. */
export const FRAME_MS = 100;
/** The set ends by itself after this long with no movement (the phone is propped 2-3 m away, out of reach). */
export const IDLE_STOP_MS = 20_000;
/** And after this long in all, to protect the battery. */
export const MAX_SET_MS = 180_000;
/** No usable legs for this long shows the "out of view" message. */
const OUT_OF_VIEW_MS = 1000;
/** This many `estimate` errors in a row mean the backend is broken (not a person out of frame): stop and say so. */
export const MAX_ESTIMATE_FAILURES = 10;

type Blocked = 'denied' | 'nocamera' | 'camera' | 'model';
type Phase = 'intro' | 'starting' | 'countdown' | 'tracking' | 'review' | 'blocked';

// The platform is read when the user starts, not when this file loads. On Android the camera is the native view (CameraX + LiteRT) and
// the model check is the native one; on the web they are the browser camera and the TensorFlow.js model.
const loadDetector = (): Promise<PoseDetector> => (Platform.OS === 'android' ? createNativePoseDetector() : import('./pose-detector').then((m) => m.createPoseDetector()));
const clock = (): number => performance.now();
const openCamera = (): Promise<CameraStream> =>
  Platform.OS === 'android' ? openNativeCamera() : navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });

export interface PoseSessionProps {
  exercise: PoseExercise;
  /** 1-based number of the set the count would go to. */
  setNumber: number;
  /** The user confirmed: write this count into the set. */
  onApply: (count: number) => void;
  onClose: () => void;
  /** Tests pass fakes; the defaults are the browser camera and the TensorFlow.js model, or on Android the permission and the native model check. */
  getStream?: () => Promise<CameraStream>;
  load?: () => Promise<PoseDetector>;
  now?: () => number;
  frameMs?: number;
  countdownSeconds?: number;
}

function blockedFor(e: unknown): Blocked {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'nocamera';
  return 'camera';
}

export function PoseSession({ exercise, setNumber, onApply, onClose, getStream = openCamera, load = loadDetector, now = clock, frameMs = FRAME_MS, countdownSeconds = 5 }: PoseSessionProps) {
  const c = useTheme();
  const [phase, setPhase] = useState<Phase>('intro');
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [left, setLeft] = useState(countdownSeconds);
  const [reps, setReps] = useState<readonly SquatRep[]>([]);
  const [outOfView, setOutOfView] = useState(false);
  const [ended, setEnded] = useState<'idle' | 'cap' | null>(null);
  const [partial, setPartial] = useState(false);
  const [cameraOn, setCameraOn] = useState(false); // Android: the permission is given, so the native camera view may mount
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<CameraStream | null>(null);
  const inferenceFails = useRef(0);
  const native = Platform.OS === 'android';
  const detector = useRef<PoseDetector | null>(null);
  const alive = useRef(true);
  const stopRef = useRef<(() => void) | null>(null); // "Finish set" while tracking
  const phaseRef = useRef<Phase>('intro');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const gen = useRef(0); // bumped when the camera is cut off by a hidden tab, so a start still in flight gives up

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    detector.current?.dispose();
    detector.current = null;
    setCameraOn(false); // unmounting the native view releases the camera and the model
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  const finish = useCallback(
    (state: RepCounterState, why: 'idle' | 'cap' | null) => {
      release();
      setReps(state.reps);
      setPartial(repInProgress(state));
      setEnded(why);
      setPhase('review');
    },
    [release],
  );

  // A hidden tab must not keep the camera on (#947): end the set with what was counted, or drop a start in progress.
  useEffect(() => {
    const away = () => {
      const p = phaseRef.current;
      if (p === 'tracking') stopRef.current?.();
      else if (p === 'starting' || p === 'countdown') {
        gen.current += 1;
        release();
        setPhase('intro');
      }
    };
    const onVisibility = () => {
      if (globalThis.document?.hidden) away();
    };
    globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
    globalThis.window?.addEventListener?.('pagehide', away);
    // Android: the app going to the background ends the set too (CameraX stops its frames then, which would only read as "out of view").
    const app = Platform.OS === 'android' ? AppState.addEventListener('change', (state) => state !== 'active' && away()) : null;
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
      globalThis.window?.removeEventListener?.('pagehide', away);
      app?.remove();
    };
  }, [release]);

  const start = async () => {
    const mine = ++gen.current;
    const live = () => alive.current && gen.current === mine;
    setPhase('starting');
    let s: CameraStream;
    try {
      s = await getStream();
    } catch (e) {
      if (!live()) return;
      setBlocked(blockedFor(e));
      setPhase('blocked');
      return;
    }
    if (!live()) return s.getTracks().forEach((tr) => tr.stop());
    stream.current = s;
    inferenceFails.current = 0;
    setCameraOn(true);
    attach();
    try {
      const d = await load();
      if (!live()) return d.dispose();
      detector.current = d;
    } catch {
      if (!live()) return;
      release();
      setBlocked('model');
      setPhase('blocked');
      return;
    }
    setLeft(countdownSeconds);
    setPhase(countdownSeconds > 0 ? 'countdown' : 'tracking');
  };

  const attach = () => {
    const v = video.current;
    if (v && stream.current && v.srcObject !== stream.current) {
      v.srcObject = stream.current as MediaStream;
      v.play?.().catch(() => {});
    }
  };
  // The video element mounts once the phase leaves "intro"; give it the stream as soon as both exist.
  useEffect(attach);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const id = setTimeout(() => (left <= 1 ? setPhase('tracking') : setLeft(left - 1)), 1000);
    return () => clearTimeout(id);
  }, [phase, left]);

  useEffect(() => {
    if (phase !== 'tracking') return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let state = initRepCounter();
    let began = -1;
    let active = -1;
    let usable = -1;
    let shown = 0;
    let fails = 0;
    let hidden = false;
    const tick = async () => {
      const d = detector.current;
      const v = video.current;
      if (stop || !d || (!v && !native)) return;
      const t0 = now();
      let found = null;
      try {
        found = await d.estimate(v);
        fails = 0;
      } catch {
        fails += 1; // one bad frame is a missing frame; a run of them is a broken backend
      }
      if (stop) return;
      if (fails >= MAX_ESTIMATE_FAILURES) {
        release();
        setBlocked('model');
        setPhase('blocked');
        return;
      }
      const at = now();
      if (began < 0) began = active = usable = at;
      const h = found ? squatSignal({ t: at, width: found.width, height: found.height, keypoints: found.keypoints }) : null;
      if (h !== null) usable = at;
      const before = state.reps.length;
      state = stepRepCounter(state, at, h);
      if (state.reps.length !== before || state.phase === 'excursion') active = at;
      if (state.reps.length !== shown) {
        shown = state.reps.length;
        setReps(state.reps);
      }
      const away = at - usable > OUT_OF_VIEW_MS;
      if (away !== hidden) {
        hidden = away;
        setOutOfView(away);
      }
      if (at - began >= MAX_SET_MS) return finish(state, 'cap');
      if (at - active >= IDLE_STOP_MS) return finish(state, 'idle');
      timer = setTimeout(tick, Math.max(0, frameMs - (now() - t0)));
    };
    stopRef.current = () => finish(state, null);
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      stopRef.current = null;
    };
  }, [phase, finish, release, now, frameMs, native]);

  const last = reps[reps.length - 1];
  const parallel = reps.filter((r) => r.reachedParallel).length;
  const shallow = reps.some((r) => !r.reachedParallel);
  const showVideo = phase === 'starting' || phase === 'countdown' || phase === 'tracking';
  const onNativeError = (message: string) => {
    if (!showVideo) return;
    // A single failed frame is a missing frame; a run of them means the model is broken (like the web's estimate errors).
    if (message === 'inference_failed' && ++inferenceFails.current < MAX_ESTIMATE_FAILURES) return;
    release();
    setBlocked(message === 'no_camera' ? 'nocamera' : message === 'model_failed' || message === 'model_hash_mismatch' || message === 'inference_failed' ? 'model' : 'camera');
    setPhase('blocked');
  };

  return (
    <View style={styles.body}>
      {phase === 'intro' ? (
        <>
          <Note>{t.intro}</Note>
          <Hint>{t.guide}</Hint>
          <Hint>{t.lighting}</Hint>
          <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' }}>{t.privacy}</Text>
          <Button label={t.start} onPress={() => void start()} />
          <Button label={t.close} kind="ghost" onPress={onClose} />
        </>
      ) : null}
      {showVideo && !native ? <video ref={video} autoPlay muted playsInline aria-label={t.camera} style={{ width: '100%', maxHeight: 360, borderRadius: 8, backgroundColor: '#000' }} /> : null}
      {showVideo && native && cameraOn ? (
        <View accessible accessibilityLabel={t.camera} style={styles.native}>
          <PoseCameraView
            style={StyleSheet.absoluteFill}
            onPose={(e) => {
              inferenceFails.current = 0;
              detector.current?.feed?.(e.nativeEvent);
            }}
            onError={(e) => onNativeError(e.nativeEvent.message)}
          />
        </View>
      ) : null}
      {phase === 'starting' ? <Text style={{ color: c.ink }} accessibilityLiveRegion="polite">{native ? t.startingApp : t.starting}</Text> : null}
      {phase === 'countdown' ? <Text style={{ color: c.ink, fontSize: 20, fontWeight: '700' }} accessibilityLiveRegion="polite">{t.countdown(left)}</Text> : null}
      {phase === 'tracking' ? (
        <>
          <View accessibilityLiveRegion="polite">
            <Text style={{ color: c.ink, fontSize: 40, fontWeight: '700' }}>{reps.length === 0 ? t.noReps : t.rep(reps.length)}</Text>
          </View>
          {last ? (
            <Text style={{ color: c.ink, fontSize: 18 }}>
              {last.reachedParallel ? t.parallel : t.above}
              {'\n'}
              {t.tempo(last.eccentricMs, last.pauseMs, last.concentricMs)}
            </Text>
          ) : (
            <Text style={{ color: c.muted, fontSize: 16 }}>{t.tracking}</Text>
          )}
          {outOfView ? <Note>{t.outOfView}</Note> : null}
          <Button label={t.finish} onPress={() => stopRef.current?.()} />
        </>
      ) : null}
      {phase === 'review' ? (
        <>
          <View accessibilityLiveRegion="polite">
            <Text style={{ color: c.ink, fontSize: 20, fontWeight: '700' }}>{t.summary(reps.length, parallel)}</Text>
          </View>
          {ended ? <Hint>{ended === 'idle' ? t.autoStopped : t.capped}</Hint> : null}
          {partial ? <Hint>{t.partial}</Hint> : null}
          {shallow ? <Note>{t.cue(DEPTH_CUES[exercise].text)}</Note> : null}
          {reps.length > 0 ? (
            <Button label={t.apply(reps.length, setNumber)} onPress={() => onApply(reps.length)} />
          ) : (
            <Hint>{t.none}</Hint>
          )}
          <Button label={reps.length > 0 ? t.discard : t.close} kind="ghost" onPress={onClose} />
        </>
      ) : null}
      {phase === 'blocked' ? (
        <>
          <Note>{blocked === 'denied' ? (native ? t.deniedApp : t.denied) : blocked === 'nocamera' ? t.noCamera : blocked === 'model' ? (native ? t.modelFailedApp : t.modelFailed) : t.cameraFailed}</Note>
          <Button label={t.retry} onPress={() => setPhase('intro')} />
          <Button label={t.close} kind="ghost" onPress={onClose} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ body: { gap: 12 }, native: { height: 320, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000' } });
