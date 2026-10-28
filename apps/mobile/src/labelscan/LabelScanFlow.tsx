import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, View } from 'react-native';
import { parseNutritionLabel, type LabelDraft, type UserFoodFields } from '@plate-and-bar/core';
import { OcrError, recognize, type OcrCrop, type OcrErrorCode } from '../../modules/plate-label-scanner';
import { PaddedWindow } from '../components/bottomInset';
import { useSheetAnimation } from '../components/reducedMotion';
import { Text } from '../components/Text';
import { Button, ErrorText, H1, Hint, Page } from '../components/ui';
import type { NewLog } from '../food/useFoodDay';
import type { UserFood } from '../food/types';
import { CameraDenied, releasePhoto, takeLabelPhoto, type LabelPhoto } from './capture';
import { LABEL_COPY as t, OCR_PROBLEM } from './copy';
import { CropStep } from './CropStep';
import { useFocusOnMount } from './focus';
import { LabelReview } from './LabelReview';

type Problem = OcrErrorCode | 'unreadable' | 'camera' | 'denied';
type Step =
  | { k: 'capture' }
  | { k: 'crop'; photo: LabelPhoto }
  | { k: 'reading' }
  | { k: 'problem'; problem: Problem }
  | { k: 'review'; draft: LabelDraft; round: number };

interface Props {
  meal: string;
  onAdd: (n: NewLog) => void;
  onSaveMine: (f: UserFoodFields) => UserFood;
  /** "Type it in": the caller opens its Custom form. */
  onCustom: () => void;
  /** Close and Android back: back to the Food list, the Add sheet stays open. */
  onClose: () => void;
  /** Add was pressed and the food is logged: close the whole Add sheet. */
  onDone: () => void;
}

const problemText = (p: Problem): string => (p === 'unreadable' ? t.unreadable : p === 'camera' ? t.cameraFailed : p === 'denied' ? t.cameraDenied : OCR_PROBLEM[p]);

/**
 * Scan a nutrition label (#1067, ADR 010): one still photo, a crop, on-device text reading, the parser, then the mandatory review.
 * The photo is held by address only, never copied or sent, and is released as soon as the scan ends, the user backs out or the
 * flow closes. Every failure has "Try again" and "Type it in". Nothing waits on the network: there is none.
 */
export function LabelScanFlow({ meal, onAdd, onSaveMine, onCustom, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>({ k: 'capture' });
  const photo = useRef<string | undefined>(undefined);
  const run = useRef(0);
  const live = useRef(true);

  const release = useCallback(() => {
    releasePhoto(photo.current);
    photo.current = undefined;
  }, []);
  /** Ends any scan in progress (its answer is ignored) and drops the photo. */
  const stop = useCallback(() => {
    run.current++;
    release();
  }, [release]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stop();
    };
  }, [stop]);

  const again = () => {
    stop();
    setStep({ k: 'capture' });
  };
  const close = () => {
    stop();
    onClose();
  };

  const capture = async (source: 'camera' | 'library') => {
    try {
      const p = await takeLabelPhoto(source);
      if (!live.current) {
        // The flow closed while the picker was open: nothing will use this photo.
        if (p) releasePhoto(p.uri);
        return;
      }
      if (!p) return;
      release();
      photo.current = p.uri;
      setStep({ k: 'crop', photo: p });
    } catch (e) {
      if (live.current) setStep({ k: 'problem', problem: e instanceof CameraDenied ? 'denied' : 'camera' });
    }
  };

  const read = async (crop: OcrCrop | undefined) => {
    const uri = photo.current;
    if (!uri) return;
    const id = ++run.current;
    setStep({ k: 'reading' });
    try {
      const r = await recognize(uri, crop);
      if (!live.current || id !== run.current) return;
      const draft = parseNutritionLabel(r.lines);
      setStep(draft.reviewable ? { k: 'review', draft, round: id } : { k: 'problem', problem: 'unreadable' });
    } catch (e) {
      if (live.current && id === run.current) setStep({ k: 'problem', problem: e instanceof OcrError ? e.code : 'failed' });
    } finally {
      // The scan is over, whatever the outcome: nothing of the photo outlives it.
      if (id === run.current) release();
    }
  };

  return (
    <Modal visible animationType={useSheetAnimation()} onRequestClose={close}>
      <PaddedWindow>
        {step.k === 'capture' ? <CaptureView onTake={(s) => void capture(s)} onCustom={onCustom} onClose={close} /> : null}
        {step.k === 'crop' ? <CropStep photo={step.photo} onRead={(c) => void read(c)} onRetake={again} onClose={close} /> : null}
        {step.k === 'reading' ? (
          <Page>
            <H1>{t.title}</H1>
            <ActivityIndicator accessibilityLabel={t.reading} />
            <Text accessibilityRole="alert" style={{ fontSize: 16 }}>{t.reading}</Text>
            <Button kind="ghost" label={t.cancel} onPress={close} />
          </Page>
        ) : null}
        {step.k === 'problem' ? <ProblemView problem={step.problem} onRetry={again} onCustom={onCustom} onClose={close} /> : null}
        {step.k === 'review' ? <LabelReview key={step.round} meal={meal} draft={step.draft} onAdd={onAdd} onSaveMine={onSaveMine} onScanAgain={again} onClose={close} onDone={onDone} /> : null}
      </PaddedWindow>
    </Modal>
  );
}

function CaptureView({ onTake, onCustom, onClose }: { onTake: (s: 'camera' | 'library') => void; onCustom: () => void; onClose: () => void }) {
  const focus = useFocusOnMount();
  return (
    <Page>
      <View ref={focus} accessible><H1>{t.title}</H1></View>
      <Hint>{t.intro}</Hint>
      <Button label={t.take} onPress={() => onTake('camera')} />
      <Button kind="ghost" label={t.choose} onPress={() => onTake('library')} />
      <Button kind="link" label={t.typeIt} onPress={onCustom} />
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}

function ProblemView({ problem, onRetry, onCustom, onClose }: { problem: Problem; onRetry: () => void; onCustom: () => void; onClose: () => void }) {
  const focus = useFocusOnMount();
  return (
    <Page>
      <View ref={focus} accessible><H1>{t.title}</H1></View>
      <ErrorText>{problemText(problem)}</ErrorText>
      {problem === 'denied' ? <Button kind="ghost" label={t.openSettings} onPress={() => void Linking.openSettings().catch(() => undefined)} /> : null}
      <Button label={t.tryAgain} onPress={onRetry} />
      <Button kind="ghost" label={t.typeIt} onPress={onCustom} />
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}
