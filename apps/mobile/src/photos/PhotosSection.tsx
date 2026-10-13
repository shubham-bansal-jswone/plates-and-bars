import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Platform, ScrollView, StyleSheet, View, type ImageStyle } from 'react-native';
import { measureAt, round1, weeklyAvg, type MeasurementFacts, type WeighIn } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Heading, Hint, Note } from '../components/ui';
import { shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Chip } from '../workout/parts';
import { CameraDenied, capturePhoto } from './capture';
import {
  CHECKIN_HOW,
  CHECKIN_PRIVATE,
  CHECKIN_TITLE,
  PHOTOS_CAMERA_OFF,
  PHOTOS_DELETED,
  PHOTOS_DELETE_FAILED,
  PHOTOS_EMPTY,
  PHOTOS_HINT_DEVICE,
  PHOTOS_HINT_WEB,
  PHOTOS_MISSING_POSE,
  PHOTOS_NEW,
  PHOTOS_NO_STORAGE,
  PHOTOS_SAVE_FAILED,
  PHOTOS_STALE,
  PHOTOS_TITLE,
  PHOTOS_UNAVAILABLE,
  POSE_LABEL,
} from './copy';
import { usePhotos, type Photos } from './usePhotos';
import { POSES, onPhotosWiped, persistent, type Pose } from './vault';
import type { StoreDb } from '../db/records';

interface Props {
  db: StoreDb;
  date: string;
  weights: readonly WeighIn[];
  tapes: readonly MeasurementFacts[];
  notify: (msg: string) => void;
}

/** Progress photos on the Progress tab (prototype `renderPhotos`): device only, check-ins, compare, delete. */
export function PhotosSection({ db, date, weights, tapes, notify }: Props) {
  const c = useTheme();
  const ph = usePhotos({ db, date });
  const [sheet, setSheet] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  // A wipe closes the sheet and forgets a half-done delete: neither may reappear in front of the next user.
  useEffect(
    () =>
      onPhotosWiped(() => {
        setSheet(false);
        setArmed(null);
      }),
    [],
  );
  const caption = (d: string) => {
    const w = weeklyAvg(weights, d);
    const waist = measureAt(tapes, 'waist_cm', d);
    return `${shortDate(d)}${w ? `, ${round1(w)} kg` : ''}${waist ? `, waist ${waist.v} cm` : ''}`;
  };
  const del = async (d: string) => {
    if (armed !== d) return setArmed(d);
    setArmed(null);
    try {
      await ph.remove(d);
      notify(PHOTOS_DELETED);
    } catch {
      notify(PHOTOS_DELETE_FAILED);
    }
  };

  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{PHOTOS_TITLE}</Heading>
      <Hint>{persistent ? PHOTOS_HINT_DEVICE : PHOTOS_HINT_WEB}</Hint>
      {!ph.ready ? (
        <Hint>Loading…</Hint>
      ) : ph.failed ? (
        <>
          <Note>{PHOTOS_UNAVAILABLE}</Note>
          <Button label="Try again" kind="ghost" onPress={ph.retry} />
        </>
      ) : (
        <>
          {!persistent ? <Note>{PHOTOS_NO_STORAGE}</Note> : null}
          {ph.staleDays !== null ? <Note>{PHOTOS_STALE(ph.staleDays)}</Note> : null}
          <Button label={PHOTOS_NEW(ph.hasToday)} onPress={() => setSheet(true)} />
          <Compare ph={ph} caption={caption} />
          {ph.thumbs.length ? (
            <>
              <Heading level={3} style={[typeScale.label, { color: c.ink }]}>Check-ins</Heading>
              <View style={styles.grid}>
                {ph.thumbs.map((t) => (
                  <View key={t.date} style={styles.thumb}>
                    {t.src ? <Image source={{ uri: t.src }} style={styles.thumbImg as ImageStyle} accessibilityLabel={`Check-in ${shortDate(t.date)}`} /> : null}
                    <Text style={{ color: c.muted, ...typeScale.caption }}>{shortDate(t.date)}</Text>
                    <Chip label={armed === t.date ? `Tap again to delete the ${shortDate(t.date)} check-in` : `Delete the ${shortDate(t.date)} check-in`} text={armed === t.date ? 'Tap again to delete' : 'Delete'} onPress={() => void del(t.date)} />
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Hint>{PHOTOS_EMPTY}</Hint>
          )}
          {sheet ? <CheckinSheet ph={ph} notify={notify} onClose={() => setSheet(false)} /> : null}
        </>
      )}
    </View>
  );
}

function Compare({ ph, caption }: { ph: Photos; caption: (d: string) => string }) {
  const c = useTheme();
  if (ph.dates.length < 2 || !ph.a || !ph.b) return null;
  const { a, b } = ph;
  const pick = (which: 'a' | 'b', value: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {ph.dates.map((d) => (
        <Chip key={d} label={`${which === 'a' ? 'Before' : 'After'}: ${shortDate(d)}`} text={shortDate(d)} pressed={d === value} onPress={() => (which === 'a' ? ph.setA(d) : ph.setB(d))} />
      ))}
    </ScrollView>
  );
  const pair = ph.pair;
  return (
    <View style={styles.compare}>
      <Heading level={3} style={[typeScale.label, { color: c.ink }]}>Compare</Heading>
      <Text style={{ color: c.body }}>Before</Text>
      {pick('a', a)}
      <Text style={{ color: c.body }}>After</Text>
      {pick('b', b)}
      <View style={styles.chips}>
        {POSES.map((p) => (
          <Chip key={p} label={POSE_LABEL[p]} pressed={ph.pose === p} onPress={() => ph.setPose(p)} />
        ))}
        <Chip label="Side by side" pressed={ph.mode === 'side'} onPress={() => ph.setMode('side')} />
        <Chip label="Slider" pressed={ph.mode === 'slider'} onPress={() => ph.setMode('slider')} />
      </View>
      {!pair ? null : !pair.a || !pair.b ? (
        <Hint>{PHOTOS_MISSING_POSE(ph.pose)}</Hint>
      ) : ph.mode === 'side' ? (
        <View style={styles.two}>
          {[
            [pair.a, a, 'Before'],
            [pair.b, b, 'After'],
          ].map(([src, d, which]) => (
            <View key={which} style={styles.half}>
              <Image source={{ uri: src as string }} style={styles.photo as ImageStyle} accessibilityLabel={`${which}, ${ph.pose}`} />
              <Text style={{ color: c.muted, ...typeScale.caption }}>{caption(d as string)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <>
          <Slider before={pair.a} after={pair.b} pose={ph.pose} />
          <Hint>{`${caption(a)} → ${caption(b)}`}</Hint>
        </>
      )}
    </View>
  );
}

/** Before under After, After clipped from the left at the handle (prototype `pp-slide`); drag, screen-reader adjust or the buttons move it. */
function Slider({ before, after, pose }: { before: string; after: string; pose: Pose }) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const [pct, setPct] = useState(50);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => width && setPct(clamp((e.nativeEvent.locationX / width) * 100)),
        onPanResponderMove: (e) => width && setPct(clamp((e.nativeEvent.locationX / width) * 100)),
      }),
    [width],
  );
  const step = (d: number) => setPct((p) => clamp(p + d));
  return (
    <>
      <View
        style={styles.slide}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Slide between before and after, ${pose}`}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 10 : -10)}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={styles.fill}>
          <Image source={{ uri: before }} style={styles.fill as ImageStyle} />
        </View>
        <View pointerEvents="none" style={[styles.clip, { left: `${pct}%` }]}>
          <Image source={{ uri: after }} style={[styles.after as ImageStyle, { width }]} />
        </View>
        <View pointerEvents="none" style={[styles.handle, { left: `${pct}%`, backgroundColor: c.onBrand }]} />
        <View pointerEvents="none" style={styles.fill}>
          <Text style={[styles.tag, styles.tagL]}>Before</Text>
          <Text style={[styles.tag, styles.tagR]}>After</Text>
        </View>
      </View>
      <View style={styles.chips}>
        <Chip label="Show more of before" text="◀" onPress={() => step(10)} />
        <Chip label="Show more of after" text="▶" onPress={() => step(-10)} />
      </View>
    </>
  );
}

/** The day's check-in (prototype `openPhotoCheckin`): one photo per pose, taken or chosen, retake replaces. */
function CheckinSheet({ ph, notify, onClose }: { ph: Photos; notify: (msg: string) => void; onClose: () => void }) {
  const c = useTheme();
  const [busy, setBusy] = useState<Pose | null>(null);
  const running = useRef(false); // a second tap before the first picker opens must not open another
  const add = async (pose: Pose, source: 'camera' | 'library') => {
    if (running.current) return;
    running.current = true;
    setBusy(pose);
    try {
      const jpeg = await capturePhoto(source);
      if (jpeg) await ph.save(pose, jpeg);
    } catch (e) {
      notify(e instanceof CameraDenied ? PHOTOS_CAMERA_OFF : PHOTOS_SAVE_FAILED);
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{CHECKIN_TITLE}</Heading>
        <Hint>{CHECKIN_HOW}</Hint>
        <View style={styles.poses}>
          {POSES.map((p) => {
            const have = ph.today[p];
            const label = POSE_LABEL[p];
            return (
              <View key={p} style={styles.pose}>
                {have ? (
                  <Image source={{ uri: have }} style={styles.photo as ImageStyle} accessibilityLabel={`${label} photo`} />
                ) : (
                  <View style={[styles.photo, styles.empty, { borderColor: c.line }]}>
                    <Text style={{ color: c.muted, ...typeScale.small }}>{busy === p ? 'Saving…' : label}</Text>
                  </View>
                )}
                <Text style={{ color: c.body, ...typeScale.caption, textAlign: 'center' }}>{label}</Text>
                {Platform.OS !== 'web' ? (
                  <Chip label={have ? `Retake ${label.toLowerCase()}` : `Take ${label.toLowerCase()}`} text={have ? 'Retake' : 'Take'} onPress={() => void add(p, 'camera')} />
                ) : null}
                <Chip label={have ? `Choose another ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`} text={have ? 'Replace' : 'Choose'} onPress={() => void add(p, 'library')} />
              </View>
            );
          })}
        </View>
        <Hint>{CHECKIN_PRIVATE}</Hint>
        <Button label="Done" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 24 },
  compare: { gap: 8, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  two: { flexDirection: 'row', gap: 8 },
  half: { flex: 1, gap: 4 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: '31%', gap: 4 },
  thumbImg: { width: '100%', aspectRatio: 3 / 4, borderRadius: 6 },
  slide: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  clip: { position: 'absolute', top: 0, bottom: 0, right: 0, overflow: 'hidden' },
  after: { position: 'absolute', top: 0, bottom: 0, right: 0, height: '100%' },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  tag: { position: 'absolute', top: 8, color: '#FFFFFF', fontWeight: '700', textShadowColor: '#000000', textShadowRadius: 3 },
  tagL: { left: 8 },
  tagR: { right: 8 },
  sheet: { padding: 16, gap: 12 },
  poses: { flexDirection: 'row', gap: 8 },
  pose: { flex: 1, gap: 6, alignItems: 'stretch' },
});
