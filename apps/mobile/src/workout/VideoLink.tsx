import { Linking } from 'react-native';
import { Text } from '../components/Text';
import { Press } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** Prototype `videoUrl`: a plain YouTube search for the exercise's form (a bracketed note in the name is dropped). It opens outside the app. */
export const videoUrl = (name: string): string => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name.replace(/\s*\(.*\)/, '') + ' proper form');

/** "Watch form videos on YouTube ↗" (prototype `.vlink`): leaves the app, and its spoken name says so. */
export function VideoLink({ name }: { name: string }) {
  const c = useTheme();
  return (
    <Press accessibilityRole="link" accessibilityLabel={`Watch form videos on YouTube for ${name}, opens outside the app`} onPress={() => void Linking.openURL(videoUrl(name)).catch(() => undefined)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={[type.textBody, { color: c.link }]}>Watch form videos on YouTube ↗</Text>
    </Press>
  );
}
