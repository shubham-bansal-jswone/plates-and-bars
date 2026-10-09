import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { buildLocalExport } from '../account/exportLocal';
import { DATA_COPY as t } from '../account/copy';
import { saveTextFile, type SaveResult } from '../account/saveFile';
import type { DeleteResult, ServerExportResult } from '../account/server';
import { Button, ErrorText, H1, Hint, Note, Page } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { useSync } from '../sync/SyncProvider';

type Step = 'home' | 'confirm' | 'done';

const saved = (name: string, r: SaveResult) => (r === 'saved' ? t.exportSaved(name) : r === 'shared' ? t.exportShared : t.exportNoShare);
const serverMessage = (r: Exclude<ServerExportResult, { kind: 'ok' }>): string =>
  r.kind === 'offline' ? t.serverOffline : r.kind === 'rate_limited' ? t.serverRate(r.retryAfterSec) : r.kind === 'unavailable' ? t.serverUnavailable : t.serverSession;
const deleteMessage = (r: Exclude<DeleteResult, { kind: 'deleted' }>): string =>
  r.kind === 'offline' ? t.offline : r.kind === 'rate_limited' ? t.rate(r.retryAfterSec) : r.kind === 'unconfirmed' ? t.unconfirmed : r.kind === 'local_failed' ? t.localFailed : t.unavailable;

/** Export and delete everything (#27; prototype `exportData`, `deleteEverything`). Export works offline from this device. */
export function DataScreen({ db, now = () => new Date() }: { db: WorkoutDb; now?: () => Date }) {
  const s = useSync();
  const router = useRouter();
  const [step, setStep] = useState<Step>('home');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<DeleteResult | null>(null);

  const run = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  const exportDevice = () =>
    run(async () => {
      try {
        const { file, csv } = await buildLocalExport(db, now());
        const day = file.exported_at.slice(0, 10);
        const json = `plate-and-bar-export-${day}.json`;
        const r = await saveTextFile(json, 'application/json', JSON.stringify(file, null, 1));
        setMessage(saved(json, r));
        // The prototype also offers the food log as a spreadsheet file.
        if (r !== 'unavailable') await saveTextFile(`plate-and-bar-food-log-${day}.csv`, 'text/csv', csv);
      } catch {
        setError(t.exportFailed);
      }
    });

  const exportServer = () =>
    run(async () => {
      const r = await s.exportFromServer();
      if (r.kind !== 'ok') return setError(serverMessage(r));
      try {
        setMessage(saved(r.filename, await saveTextFile(r.filename, 'application/json', r.json)));
      } catch {
        setError(t.exportFailed);
      }
    });

  const confirmDelete = () =>
    run(async () => {
      const r = await s.deleteEverything();
      if (r.kind === 'deleted') {
        setDeleted(r);
        setStep('done');
      } else setError(deleteMessage(r));
    });

  if (step === 'done') {
    return (
      <Page>
        <H1>{t.title}</H1>
        <Note>{deleted?.kind === 'deleted' && deleted.server ? t.deletedAll : t.deletedLocal}</Note>
        <Button label={t.done} onPress={() => router.replace('/' as never)} />
      </Page>
    );
  }

  if (step === 'confirm') {
    return (
      <Page>
        <H1>{t.confirmTitle}</H1>
        <Note>{t.confirmDevice}</Note>
        <Note>{s.signedIn ? t.confirmAccount : t.confirmDeviceSignedOut}</Note>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={{ gap: 12 }}>
          <Button label={busy ? t.deleting : t.confirmDelete} onPress={() => void confirmDelete()} />
          <Button
            kind="ghost"
            label={t.cancel}
            onPress={() => {
              setError(null);
              setStep('home');
            }}
          />
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <H1>{t.title}</H1>
      <Hint>{t.intro}</Hint>
      <Hint>{t.exportHint}</Hint>
      {message ? <Note>{message}</Note> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ gap: 12 }}>
        <Button label={busy ? t.exporting : t.exportDevice} onPress={() => void exportDevice()} />
        {s.signedIn ? (
          <>
            <Hint>{t.exportServerHint}</Hint>
            <Button kind="ghost" label={t.exportServer} onPress={() => void exportServer()} />
          </>
        ) : null}
        <Button
          kind="ghost"
          label={t.delete}
          onPress={() => {
            setMessage(null);
            setError(null);
            setStep('confirm');
          }}
        />
        <Button kind="link" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as never))} />
      </View>
    </Page>
  );
}
