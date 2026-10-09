import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ErrorText, Field, H1, Hint, Note, Page } from '../components/ui';
import { useSync } from '../sync/SyncProvider';
import { SIGN_IN_COPY as t } from '../sync/copy';

type Step = 'email' | 'code' | 'refused' | 'confirm-discard';

/** Optional sign-in by emailed code, and sign-out with the unsynced-changes guard (#31). The app works fully without it. */
export function SignInScreen() {
  const s = useSync();
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  if (!s.configured) {
    return (
      <Page>
        <H1>{t.title}</H1>
        <Hint>{t.unavailable}</Hint>
      </Page>
    );
  }

  if (s.signedIn) {
    const unsynced = s.pending;
    return (
      <Page>
        <H1>{t.title}</H1>
        <Hint>{unsynced > 0 ? t.unsynced(unsynced) : t.allSynced}</Hint>
        {s.last?.status === 'unavailable' || s.last?.status === 'offline' ? <Note>{t.retrying}</Note> : null}
        {s.last && s.last.conflicts > 0 ? <Note>{t.conflicts(s.last.conflicts)}</Note> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={{ gap: 12 }}>
          {step === 'confirm-discard' ? (
            <>
              <Note>{t.confirmDiscard(pending)}</Note>
              <Button
                label={t.discardAndSignOut}
                onPress={() =>
                  void run(async () => {
                    await s.signOut({ discard: true });
                    setStep('email');
                  })
                }
              />
              <Button kind="ghost" label={t.cancel} onPress={() => setStep('email')} />
            </>
          ) : (
            <>
              <Button kind="ghost" label={t.syncNow} onPress={() => void run(async () => void (await s.syncNow()))} />
              <Button
                kind="ghost"
                label={unsynced > 0 ? t.syncThenSignOut : t.signOut}
                onPress={() =>
                  void run(async () => {
                    if (unsynced > 0) await s.syncNow();
                    const blocked = await s.signOut();
                    if (blocked > 0) setError(t.stillUnsynced(blocked));
                  })
                }
              />
              {unsynced > 0 ? (
                <Button
                  kind="link"
                  label={t.discardAndSignOut}
                  onPress={() => {
                    setPending(unsynced);
                    setStep('confirm-discard');
                  }}
                />
              ) : null}
            </>
          )}
        </View>
      </Page>
    );
  }

  if (step === 'refused') {
    return (
      <Page>
        <H1>{t.title}</H1>
        <Note>{t.refused(pending)}</Note>
        <View style={{ gap: 12 }}>
          <Button
            label={t.signInAsPrevious}
            onPress={() => {
              setCode('');
              setStep('email');
            }}
          />
          <Button
            kind="ghost"
            label={t.discardAndSignOut}
            onPress={() => {
              setPending(pending);
              setStep('confirm-discard');
            }}
          />
        </View>
      </Page>
    );
  }

  if (step === 'confirm-discard') {
    return (
      <Page>
        <H1>{t.title}</H1>
        <Note>{t.confirmDiscard(pending)}</Note>
        <View style={{ gap: 12 }}>
          <Button
            label={t.discardAndSignOut}
            onPress={() =>
              void run(async () => {
                await s.discardAndSignOut();
                setStep('email');
              })
            }
          />
          <Button kind="ghost" label={t.cancel} onPress={() => setStep('refused')} />
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <H1>{t.title}</H1>
      <Hint>{t.optional}</Hint>
      {step === 'email' ? (
        <>
          <Field label={t.emailLabel} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button
            label={busy ? t.sending : t.sendCode}
            onPress={() =>
              void run(async () => {
                const r = await s.startSignIn(email.trim());
                if (r.ok) setStep('code');
                else setError(t.startError(r.reason));
              })
            }
          />
        </>
      ) : (
        <>
          <Hint>{t.codeSent}</Hint>
          <Field label={t.codeLabel} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button
            label={busy ? t.verifying : t.verify}
            onPress={() =>
              void run(async () => {
                const r = await s.verifyCode(email.trim(), code.trim());
                if (r.kind === 'refused') {
                  setPending(r.pending);
                  setStep('refused');
                } else if (r.kind === 'error') setError(t.verifyError(r.reason));
                else router.back();
              })
            }
          />
          <Button kind="link" label={t.useAnotherEmail} onPress={() => setStep('email')} />
        </>
      )}
    </Page>
  );
}
