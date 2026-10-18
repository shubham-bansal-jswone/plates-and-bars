import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, ErrorText, Field, Hint, Label } from '../components/ui';
import { CameraDenied } from '../photos/capture';
import { useTheme } from '../theme/useTheme';
import { isBlank } from '../text/blank';
import { useAi } from './AiProvider';
import type { AiImage } from './client';
import { AI_COPY, failureMessage, imageFailureMessage } from './copy';
import { pickPhotoForAi } from './photo';
import { importedRecipe, type ImportedRecipe } from './recipeImport';

/** Prototype: the text is cut at 6,000 characters (the contract's `text` `maxLength`). */
const TEXT_MAX = 6000;

/**
 * Import a recipe (AI) from pasted text, a photo of a page, or both. Shows only while the feature is available. The draft
 * goes to `onDraft` for the recipe builder; nothing is saved by the call. The photo stays in this component's state (in
 * memory) and is dropped when the panel closes.
 */
export function ImportRecipe({ known, onDraft }: { known: ReadonlySet<string>; onDraft: (r: ImportedRecipe) => void }) {
  const ai = useAi();
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [image, setImage] = useState<AiImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => void (alive.current = false), []);

  if (!open) return ai.available('import_recipe') ? <View style={styles.start}><Button kind="link" label={AI_COPY.importOpen} onPress={() => setOpen(true)} /></View> : null;

  const close = () => {
    setOpen(false);
    setText('');
    setImage(null);
    setError(null);
  };
  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const got = await pickPhotoForAi(source);
      if (alive.current && got) setImage(got);
    } catch (e) {
      if (alive.current) setError(e instanceof CameraDenied ? AI_COPY.photoCameraOff : AI_COPY.photoUnreadable);
    }
  };
  const exhausted = ai.quotaUsed();
  const go = async () => {
    if (inFlight.current || ai.quotaUsed()) return;
    const body = { ...(isBlank(text) ? null : { text: text.slice(0, TEXT_MAX) }), ...(image ? { image } : null) };
    if (!body.text && !body.image) return setError(AI_COPY.importEmpty);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await ai.importRecipe(body);
    inFlight.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(imageFailureMessage(r, AI_COPY.importFallback, AI_COPY.importInvalid));
    const draft = importedRecipe(r.data, known);
    if (!draft.rows.length) return setError(AI_COPY.importNone);
    onDraft(draft);
    close();
  };

  return (
    <View style={styles.panel}>
      <Label>{AI_COPY.importTitle}</Label>
      <Field label={AI_COPY.importTextLabel} placeholder={AI_COPY.importPlaceholder} multiline maxLength={TEXT_MAX} value={text} onChangeText={setText} />
      {image ? <Image source={{ uri: `data:${image.media_type};base64,${image.data}` }} accessibilityLabel="Your recipe photo" resizeMode="cover" style={[styles.preview, { backgroundColor: c.surfaceSoft }]} /> : null}
      <View style={styles.row}>
        <Button kind="ghost" label={image ? AI_COPY.importPhotoAdded : AI_COPY.importAddPhoto} a11yLabel={image ? 'Photo added, choose a different photo' : 'Add a photo of the recipe from your gallery'} onPress={() => void pick('library')} />
        <Button kind="ghost" label={AI_COPY.photoTake} a11yLabel="Take a photo of the recipe" onPress={() => void pick('camera')} />
        {image ? <Button kind="link" label={AI_COPY.importRemovePhoto} onPress={() => setImage(null)} /> : null}
      </View>
      {exhausted ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.importFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
      <View style={styles.row}>
        {exhausted ? null : <Button label={busy ? AI_COPY.importBusy : AI_COPY.importGo} a11yLabel={AI_COPY.importGo} busy={busy} onPress={() => void go()} />}
        <Button kind="ghost" label={AI_COPY.importCancel} onPress={close} />
      </View>
      <Hint>{AI_COPY.photoPrivacy}</Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  start: { alignItems: 'flex-start' },
  panel: { gap: 8, marginTop: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  preview: { width: '100%', height: 160, borderRadius: 8 },
});
