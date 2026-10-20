import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Text } from '../components/Text';
import { DATA_COPY } from '../account/copy';
import { Button, Card, H1, Hint, Label, Page, Press } from '../components/ui';
import { versionLine } from '../appVersion';
import { getMotionCredits, type MotionEntry } from '../motion/data';
import { LegalLinks } from '../legal/LegalLinks';
import { LicencesScreen } from './LicencesScreen';
import { LICENCES_COPY as lc, REPO_FILES } from './licences';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { getFigureSources, licenceLabel } from '../workout/figures';
import { ABOUT_COPY as t, BODY_MAP_LICENCE, BODY_MAP_SOURCE, FONT_SOURCES, getFoodSources, sourceKey, type SourceInfo } from './sources';

function MotionCredit({ name, e }: { name: string; e: MotionEntry }) {
  const c = useTheme();
  const link = (label: string, text: string, url: string) => (
    <Press accessibilityRole="link" accessibilityLabel={label} onPress={() => void Linking.openURL(url)} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <Text style={[type.caption, { color: c.link }]}>{text}</Text>
    </Press>
  );
  const licence = licenceLabel(e.licence);
  return (
    <Card>
      <Text style={[type.bodyStrong, { color: c.ink }]}>{name}</Text>
      <Text style={[type.caption, { color: c.body }]}>{e.author}</Text>
      {e.licence_url ? link(`${licence}. Opens the licence`, licence, e.licence_url) : <Text style={[type.caption, { color: c.body }]}>{licence}</Text>}
      {e.source === 'cc_licensed' && e.source_url ? (
        <>
          {link(`${t.sourceLink} for ${name}. Opens the clip's page`, t.sourceLink, e.source_url)}
          {e.retrieved ? <Text style={[type.caption, { color: c.body }]}>{t.retrieved(e.retrieved)}</Text> : null}
        </>
      ) : null}
      {e.source === 'own_filming' ? <Text style={[type.caption, { color: c.body }]}>{t.filmed}</Text> : null}
    </Card>
  );
}

function Source({ s }: { s: SourceInfo }) {
  const c = useTheme();
  return (
    <Card>
      <Text style={[type.bodyStrong, { color: c.ink }]}>{s.name}</Text>
      <Text style={[type.caption, { color: c.body }]}>{t.licence(s.licence)}</Text>
      {s.url ? (
        <Press accessibilityRole="link" accessibilityLabel={`Open ${s.url}`} onPress={() => void Linking.openURL(s.url!)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.caption, { color: c.link }]}>{s.url}</Text>
        </Press>
      ) : null}
      {s.reference ? <Text style={[type.caption, { color: c.body }]}>{`Reference: ${s.reference}`}</Text> : null}
    </Card>
  );
}

/** Attribution: every data source and its licence (ADR 002 and 005). Text only; works offline. */
export function AboutScreen({ onBack }: { onBack: () => void }) {
  const c = useTheme();
  const version = versionLine();
  const drawings = getFigureSources();
  const motion = getMotionCredits();
  const [showLicences, setShowLicences] = useState(false);
  if (showLicences) return <LicencesScreen onBack={() => setShowLicences(false)} />;
  return (
    <Page>
      <Button label="Back" kind="link" onPress={onBack} />
      <H1>{t.title}</H1>
      <Hint>{t.intro}</Hint>
      {version ? <Text style={{ color: c.ink }}>{version}</Text> : null}
      <Label>{t.privacy}</Label>
      <Hint>{DATA_COPY.withdraw}</Hint>
      <LegalLinks />
      <Label>{t.food}</Label>
      <View style={{ gap: 8 }}>{getFoodSources().map((s) => <Source key={sourceKey(s)} s={s} />)}</View>
      <Label>{t.exercises}</Label>
      <Hint>{t.exercisesText}</Hint>
      {drawings.length > 0 ? (
        <>
          <Label>{t.drawings}</Label>
          <View style={{ gap: 8 }}>
            {drawings.map((d) => (
              <Source key={`${d.source}|${d.licence}|${d.author}`} s={{ code: d.source, name: `${d.author}: ${d.count} exercise ${d.count === 1 ? 'drawing' : 'drawings'}`, licence: licenceLabel(d.licence), url: d.licence_url }} />
            ))}
          </View>
        </>
      ) : null}
      {motion.length > 0 ? (
        <>
          <Text accessibilityRole="header" style={[type.bodyStrong, { color: c.ink }]}>{t.motion}</Text>
          <View style={{ gap: 8 }}>{motion.map((m) => <MotionCredit key={m.name} name={m.name} e={m.entry} />)}</View>
        </>
      ) : null}
      <Label>{t.fonts}</Label>
      <View style={{ gap: 8 }}>{FONT_SOURCES.map((s) => <Source key={s.code} s={s} />)}</View>
      <Label>{t.bodyMap}</Label>
      <Source s={BODY_MAP_SOURCE} />
      <Hint>{BODY_MAP_LICENCE}</Hint>
      <Label>{lc.section}</Label>
      <Hint>{lc.summary}</Hint>
      <Button label={lc.open} kind="ghost" onPress={() => setShowLicences(true)} />
      <Label>{lc.repoDocs}</Label>
      <View style={{ gap: 4 }}>
        {REPO_FILES.map((f) => (
          <Press key={f.url} accessibilityRole="link" accessibilityLabel={`Open ${f.label}`} onPress={() => void Linking.openURL(f.url)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={[type.caption, { color: c.link }]}>{f.label}</Text>
          </Press>
        ))}
      </View>
    </Page>
  );
}
