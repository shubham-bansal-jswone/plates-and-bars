import { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { validateBarcode, type BarcodeCheck, type ScannerFormat } from '@plate-and-bar/core';
import { BarcodeScannerView, type BarcodeEvent, type BarcodeFormat } from '../../modules/plate-barcode-scanner';
import { Button, Caption, ErrorText, Field, H1, Heading, Hint, Page } from '../components/ui';
import { buzz } from '../haptics';
import { useTheme } from '../theme/useTheme';
import { BARCODE_COPY as t } from './copy';
import { checkCamera, requestCamera, type CameraPermission } from './permission';

/** A barcode that passed core's check: `code` is EAN-8, EAN-13 or the 12-digit UPC-A (a scanned UPC-E is already expanded). */
export type ValidBarcode = Extract<BarcodeCheck, { ok: true }>;

const HINT: Record<BarcodeFormat, ScannerFormat> = { EAN_13: 'ean_13', EAN_8: 'ean_8', UPC_A: 'upc_a', UPC_E: 'upc_e' };

export type ScanSource = { kind: 'scan'; format: BarcodeFormat } | { kind: 'typed' };

/**
 * Full-screen barcode reader with an always-present "type the barcode instead" path (#944). Reports validated digits and where they
 * came from; the caller decides what to do next (the app wiring comes later). Camera frames stay in memory in the native view:
 * nothing is stored or sent. A read pauses the scanner until the screen is shown again.
 */
export function BarcodeScanScreen({ onCode, onClose }: { onCode: (barcode: ValidBarcode, source: ScanSource) => void; onClose: () => void }) {
  const c = useTheme();
  const [permission, setPermission] = useState<CameraPermission | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [active, setActive] = useState(true);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [misread, setMisread] = useState(false);

  useEffect(() => {
    let live = true;
    void checkCamera().then((p) => live && setPermission(p));
    return () => {
      live = false;
    };
  }, []);

  // Back from Settings: the user may have turned the camera on.
  useEffect(() => {
    if (permission !== 'blocked' && permission !== 'denied') return;
    let live = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkCamera().then((p) => live && setPermission(p));
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [permission]);

  const ask = async () => setPermission(await requestCamera());

  const scanning = permission === 'granted' && !cameraFailed;
  const fieldOpen = typing || !scanning;

  const submit = () => {
    // Core does not trim: strip the spaces and hyphens a pack may print. A typed 8-digit number is an EAN-8 (no scanner hint).
    const check = validateBarcode(text.replace(/[\s-]/g, ''));
    if (!check.ok) {
      setError(t.invalid);
      return;
    }
    setError(null);
    onCode(check, { kind: 'typed' });
  };

  const onBarcode = (e: BarcodeEvent) => {
    const { code, format } = e.nativeEvent;
    const check = validateBarcode(code, HINT[format]);
    if (!check.ok) {
      // The reader checks the digit already; a misread that got through pauses the scanner until the user taps "Scan again".
      setActive(false);
      setMisread(true);
      return;
    }
    setActive(false);
    buzz(40);
    onCode(check, { kind: 'scan', format });
  };

  return (
    <Page>
      <H1>{t.title}</H1>
      {permission === null ? null : scanning ? (
        <View style={[styles.finder, { backgroundColor: c.surfaceSoft }]}>
          <BarcodeScannerView
            style={StyleSheet.absoluteFill}
            torch={torch}
            active={active}
            onBarcode={onBarcode}
            onReady={(e) => setHasTorch(e.nativeEvent.torch)}
            onError={() => setCameraFailed(true)}
          />
        </View>
      ) : null}
      {scanning ? <Hint>{t.viewfinder}</Hint> : null}
      {scanning && misread ? <ErrorText>{t.invalid}</ErrorText> : null}
      {scanning && misread ? <Button kind="ghost" label={t.scanAgain} onPress={() => { setMisread(false); setActive(true); }} /> : null}
      {scanning && hasTorch ? <Button kind="ghost" label={torch ? t.torchOff : t.torchOn} onPress={() => setTorch((v) => !v)} /> : null}

      {permission === 'denied' ? (
        <>
          <Hint>{t.rationale}</Hint>
          <Button label={t.allow} a11yLabel={t.allowA11y} onPress={() => void ask()} />
        </>
      ) : null}
      {permission === 'blocked' ? (
        <>
          <ErrorText>{t.denied}</ErrorText>
          <Button kind="ghost" label={t.openSettings} onPress={() => void Linking.openSettings().catch(() => undefined)} />
        </>
      ) : null}
      {permission === 'unavailable' ? <Hint>{t.unavailable}</Hint> : null}
      {cameraFailed ? <ErrorText>{t.cameraFailed}</ErrorText> : null}

      {scanning && !typing ? <Button kind="link" label={t.typeInstead} onPress={() => setTyping(true)} /> : null}
      {fieldOpen && permission !== null ? (
        <View style={styles.typed}>
          <Heading level={2}>{t.typeInstead}</Heading>
          <Caption>{t.fieldLabel}</Caption>
          <Field
            label={t.fieldLabel}
            placeholder={t.fieldHint}
            value={text}
            onChangeText={(v) => {
              setText(v);
              setError(null);
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={20}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label={t.use} onPress={submit} />
        </View>
      ) : null}
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}

const styles = StyleSheet.create({
  finder: { height: 280, borderRadius: 8, overflow: 'hidden' },
  typed: { gap: 8 },
});
