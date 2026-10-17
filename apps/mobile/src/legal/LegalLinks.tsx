import { Linking, View } from 'react-native';
import { Text } from '../components/Text';
import { Press } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { legalLinks } from './siteLinks';

/** Privacy policy, terms and account deletion page on the website. Renders nothing when no site URL is set. */
export function LegalLinks() {
  const c = useTheme();
  const links = legalLinks();
  if (links.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      {links.map((l) => (
        <Press key={l.url} accessibilityRole="link" accessibilityLabel={l.label} onPress={() => void Linking.openURL(l.url)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[type.caption, { color: c.link }]}>{l.label}</Text>
        </Press>
      ))}
    </View>
  );
}
