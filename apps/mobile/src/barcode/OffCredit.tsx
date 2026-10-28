import { Linking } from 'react-native';
import { Text } from '../components/Text';
import { Press } from '../components/ui';
import { linkText } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BARCODE_COPY as t } from './copy';

/** The credit the Open Food Facts licence asks for (ODbL, #944 spec D7): shown on every scanned food, linking to its product page. Digits only reach the URL. */
export function OffCredit({ code }: { code: string }) {
  const c = useTheme();
  if (!/^[0-9]{8,14}$/.test(code)) return null;
  const url = `https://world.openfoodfacts.org/product/${code}`;
  return (
    <Press accessibilityRole="link" accessibilityLabel={t.attributionA11y} onPress={() => void Linking.openURL(url).catch(() => undefined)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={[linkText, { color: c.link, fontSize: 14 }]}>{t.attribution}</Text>
    </Press>
  );
}
