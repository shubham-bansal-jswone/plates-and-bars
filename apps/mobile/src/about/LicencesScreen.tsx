import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Text } from '../components/Text';
import { useBottomInset } from '../components/bottomInset';
import { Button, ErrorText, Heading, Hint, H1, Press, a11yState } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { LICENCES_COPY as t, licenceRows, loadLicences, type LicenceData, type LicenceEntry, type LicenceRow } from './licences';

function Entry({ e, text, open, onToggle }: { e: LicenceEntry; text: string | null; open: boolean; onToggle: () => void }) {
  const c = useTheme();
  const title = e.version ? `${e.name} ${e.version}` : e.name;
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${t.licence(e.licence)}`}
        {...a11yState({ expanded: open })}
        onPress={onToggle}
        style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 6 }}
      >
        <Text style={[type.bodyStrong, { color: c.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: c.body }]}>{e.licence}</Text>
      </Press>
      {open ? (
        <View style={{ paddingBottom: 10 }}>
          {e.url ? <Text selectable style={[type.caption, { color: c.ink }]}>{e.url}</Text> : null}
          {e.in ? <Text style={[type.caption, { color: c.body }]}>{t.linkedInto(e.in)}</Text> : null}
          <Text selectable style={[type.caption, { color: c.body }]}>{text ?? t.noNotice}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Every open-source package, Android library, native component and bundled asset with its licence, from the build-time `licences.json`. Virtualised: there are hundreds of rows. */
export function LicencesScreen({ onBack }: { onBack: () => void }) {
  const c = useTheme();
  const bottom = useBottomInset();
  const [data, setData] = useState<LicenceData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    loadLicences().then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const rows = useMemo(() => (data ? licenceRows(data) : []), [data]);
  const texts = data?.texts ?? {};
  const [openKey, setOpenKey] = useState<string | null>(null);
  const render = useCallback(
    ({ item }: { item: LicenceRow }) =>
      item.kind === 'heading' ? (
        <View style={{ paddingTop: 16 }}>
          <Heading level={2} style={[type.heading, { color: c.ink }]}>{item.title}</Heading>
          {item.hint ? <Hint>{item.hint}</Hint> : null}
        </View>
      ) : (
        <Entry e={item.entry} text={item.entry.text ? texts[item.entry.text] ?? null : null} open={openKey === item.key} onToggle={() => setOpenKey((k) => (k === item.key ? null : item.key))} />
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, data, openKey],
  );
  return (
    <View role="main" style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={rows}
        extraData={openKey}
        keyExtractor={(r) => r.key}
        renderItem={render}
        initialNumToRender={12}
        windowSize={5}
        maxToRenderPerBatch={10}
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottom, maxWidth: 720, width: '100%', alignSelf: 'center' }}
        ListHeaderComponent={
          <View>
            <Button label="Back" kind="link" onPress={onBack} />
            <H1>{t.title}</H1>
            <Hint>{t.intro}</Hint>
            {data ? null : failed ? (
              <View>
                <ErrorText>{t.failed}</ErrorText>
                <Button label={t.retry} kind="ghost" onPress={() => {
                    setFailed(false);
                    setAttempt((n) => n + 1);
                  }} />
              </View>
            ) : (
              <Hint>{t.loading}</Hint>
            )}
          </View>
        }
      />
    </View>
  );
}
