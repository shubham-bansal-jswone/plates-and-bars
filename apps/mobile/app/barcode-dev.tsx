import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { Button, H1, Hint, Note, Page } from '../src/components/ui';
import { BarcodeScanScreen } from '../src/barcode/BarcodeScanScreen';
import { barcodeScanEnabled } from '../src/barcode/flag';

/** Dev and test path for the barcode scanner (#944): shows the digits it read. Off (sends you home) unless EXPO_PUBLIC_BARCODE_SCAN=1. */
export default function BarcodeDev() {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  if (!barcodeScanEnabled()) return <Redirect href="/" />;
  if (result !== null) {
    return (
      <Page>
        <H1>Barcode read</H1>
        <Note>{result}</Note>
        <Hint>Developer screen. Nothing was saved or sent.</Hint>
        <Button label="Scan again" onPress={() => { setResult(null); setRound((r) => r + 1); }} />
        <Button kind="ghost" label="Close" onPress={() => router.back()} />
      </Page>
    );
  }
  return <BarcodeScanScreen key={round} onCode={(digits, s) => setResult(`${digits} (${s.kind === 'scan' ? s.format : 'typed'})`)} onClose={() => router.back()} />;
}
