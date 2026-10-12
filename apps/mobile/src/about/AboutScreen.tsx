import { Linking, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Card, H1, Hint, Label, Page, Press } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ABOUT_COPY as t, FONT_SOURCES, getFoodSources, sourceKey, type SourceInfo } from './sources';

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
  return (
    <Page>
      <Button label="Back" kind="link" onPress={onBack} />
      <H1>{t.title}</H1>
      <Hint>{t.intro}</Hint>
      <Label>{t.food}</Label>
      <View style={{ gap: 8 }}>{getFoodSources().map((s) => <Source key={sourceKey(s)} s={s} />)}</View>
      <Label>{t.exercises}</Label>
      <Hint>{t.exercisesText}</Hint>
      <Label>{t.fonts}</Label>
      <View style={{ gap: 8 }}>{FONT_SOURCES.map((s) => <Source key={s.code} s={s} />)}</View>
    </Page>
  );
}
