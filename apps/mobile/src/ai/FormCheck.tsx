import { useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/Sheet';
import { Text } from '../components/Text';
import { a11yState, Button, ErrorText, Heading, Hint, Label, Note, Press } from '../components/ui';
import { CameraDenied } from '../photos/capture';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from '../workout/catalog';
import { useAi } from './AiProvider';
import type { AiFrame } from './client';
import { AI_COPY, failureMessage, formCheckFailureMessage } from './copy';
import { frameFromCamera, framesFromPhotos, framesFromVideo, FRAMES_MAX, FRAMES_MIN, VideoUnreadable } from './frames';
import type { Schemas } from '@plate-and-bar/api';

/**
 * "Check my form" on an exercise card (#946): shows only when the server has Form check on, the user has given AI consent and
 * the exercise is in the catalogue (a custom exercise has no cues to judge). The sheet is not mounted until it is opened.
 */
export function FormCheckButton({ name }: { name: string }) {
  const ai = useAi();
  const [open, setOpen] = useState(false);
  if (!ai.available('form_check') || !Object.prototype.hasOwnProperty.call(getCatalog().cards, name)) return null;
  return (
    <>
      <Button kind="link" label={AI_COPY.formOpen} a11yLabel={`${AI_COPY.formOpen} on ${name}`} expanded={open} onPress={() => setOpen(true)} />
      {open ? <FormCheckSheet name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type Reply = Schemas['FormCheckResponse'];

function FormCheckSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const c = useTheme();
  const ai = useAi();
  const cues = getCatalog().cards[name]?.key_cues ?? [];
  const [frames, setFrames] = useState<AiFrame[]>([]);
  const [cutting, setCutting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => void (alive.current = false), []);

  const choose = async (load: () => Promise<AiFrame[] | null>, failed: string) => {
    if (inFlight.current || cutting) return;
    setError(null);
    setCutting(true);
    try {
      const got = await load();
      if (!alive.current || !got) return;
      setFrames(got);
      setReply(null);
      if (got.length < FRAMES_MIN) setError(AI_COPY.formFew);
    } catch (e) {
      if (alive.current) setError(e instanceof CameraDenied ? AI_COPY.photoCameraOff : e instanceof VideoUnreadable ? AI_COPY.formVideoFailed : failed);
    } finally {
      if (alive.current) setCutting(false);
    }
  };
  const take = () =>
    choose(async () => {
      const f = await frameFromCamera();
      return f ? [...frames, f].slice(-FRAMES_MAX) : null;
    }, AI_COPY.photoUnreadable);

  const exhausted = ai.quotaUsed();
  const run = async () => {
    if (inFlight.current || ai.quotaUsed() || frames.length < FRAMES_MIN) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await ai.formCheck(name, frames);
    inFlight.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(formCheckFailureMessage(r, AI_COPY.formFallback));
    setReply(r.data);
  };

  return (
    <SheetModal title={AI_COPY.formTitle(name)} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{AI_COPY.formTitle(name)}</Heading>
          <Hint>{AI_COPY.formHow}</Hint>
          <View style={styles.row}>
            {Platform.OS === 'web' ? null : <Button kind="ghost" label={frames.length ? AI_COPY.formVideoAnother : AI_COPY.formVideo} onPress={() => void choose(framesFromVideo, AI_COPY.formVideoFailed)} />}
            <Button kind="ghost" label={AI_COPY.formPhotos} onPress={() => void choose(framesFromPhotos, AI_COPY.photoUnreadable)} />
            <Button kind="ghost" label={AI_COPY.formTake} onPress={() => void take()} />
            {frames.length ? <Button kind="link" label={AI_COPY.formClear} onPress={() => { setFrames([]); setReply(null); setError(null); }} /> : null}
          </View>
          {cutting ? <Text accessibilityLiveRegion="polite" style={{ color: c.muted }}>{AI_COPY.formCutting}</Text> : null}
          {frames.length ? (
            <>
              <View style={styles.row}>
                {frames.map((f, i) => (
                  <Image key={i} source={{ uri: `data:${f.media_type};base64,${f.data}` }} accessibilityLabel={AI_COPY.formFrame(i + 1)} resizeMode="cover" style={[styles.frame, { backgroundColor: c.surfaceSoft }]} />
                ))}
              </View>
              <Hint>{AI_COPY.formFrames(frames.length)}</Hint>
            </>
          ) : (
            <Hint>{AI_COPY.formNeedTwo}</Hint>
          )}
          {exhausted ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.formFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
          {busy ? <Text accessibilityLiveRegion="polite" style={{ color: c.muted }}>{AI_COPY.formBusy}</Text> : null}
          {frames.length >= FRAMES_MIN && !exhausted ? <Button label={busy ? AI_COPY.formBusy : AI_COPY.formRun} a11yLabel={AI_COPY.formRun} busy={busy} onPress={() => void run()} /> : null}
          <View style={styles.gap}>
            <Label>{AI_COPY.formCues}</Label>
            {cues.map((q, k) => (
              <Press key={k} accessibilityRole="checkbox" accessibilityLabel={q} {...a11yState({ checked: ticked.has(k) })} onPress={() => setTicked((t) => { const n = new Set(t); if (!n.delete(k)) n.add(k); return n; })} style={styles.cue}>
                <View style={[styles.box, { borderColor: c.brand, backgroundColor: ticked.has(k) ? c.brand : 'transparent' }]}>{ticked.has(k) ? <Text style={{ color: c.onBrand, fontWeight: '700' }}>✓</Text> : null}</View>
                <Text style={{ color: c.ink, flex: 1 }}>{q}</Text>
              </Press>
            ))}
          </View>
          {reply ? (
            <View accessibilityLiveRegion="polite" style={styles.gap}>
              <Heading level={3} style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>{AI_COPY.formSecond}</Heading>
              {reply.visible === false ? <Note>{AI_COPY.formNotVisible}</Note> : null}
              {reply.checks.map((x, i) => (
                <View key={i} accessible accessibilityLabel={`${AI_COPY.formStatus[x.status] ?? 'Note'}: ${x.cue}${x.note ? `. ${x.note}` : ''}`} style={[styles.check, { borderColor: x.status === 'watch' ? c.danger : c.line, backgroundColor: c.surface }]}>
                  <Text style={{ color: c.ink, fontWeight: '700' }}>{AI_COPY.formStatus[x.status] ?? 'Note'}</Text>
                  <Text style={{ color: c.ink }}>{x.note ? `${x.cue}: ${x.note}` : x.cue}</Text>
                </View>
              ))}
              {reply.summary ? <Text style={{ color: c.ink }}>{reply.summary}</Text> : null}
              <Hint>{AI_COPY.formDisclaimer}</Hint>
            </View>
          ) : null}
          <Hint>{AI_COPY.photoPrivacy}</Hint>
          <Button kind="ghost" label="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  gap: { gap: 8 },
  frame: { width: 72, height: 96, borderRadius: 8 },
  cue: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  check: { gap: 2, padding: 10, borderRadius: 8, borderWidth: 1 },
});
