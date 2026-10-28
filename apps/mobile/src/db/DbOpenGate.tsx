import { Component, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { Text } from '../components/Text';
import { Button } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** Waits before each automatic re-open on web: about 2 s in all, in case the other tab is closing. */
export const OPEN_RETRY_DELAYS_MS = [250, 500, 1250] as const;

/** The web database keeps an exclusive OPFS access handle, so a second tab of the same origin cannot open it (#1232). */
export function isAccessHandleError(e: unknown): boolean {
  const text = `${(e as { name?: unknown } | null)?.name ?? ''} ${(e as { message?: unknown } | null)?.message ?? ''}`;
  return /access handle|NoModificationAllowedError/i.test(text);
}

type State = { error: unknown; attempt: number; tries: number; held: boolean };

/**
 * Wraps the SQLite provider. On web, an access-handle failure is retried with a short back-off by remounting the provider
 * (`attempt` is its key), then shown as "open in another tab" with a Retry button. Any other error is rethrown, as before.
 * Native is unchanged.
 */
export class DbOpenGate extends Component<{ render: (attempt: number) => ReactNode }, State> {
  state: State = { error: null, attempt: 0, tries: 0, held: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (Platform.OS !== 'web' || !isAccessHandleError(error)) return;
    const { tries } = this.state;
    if (tries < OPEN_RETRY_DELAYS_MS.length) {
      this.timer = setTimeout(() => this.setState((s) => ({ error: null, attempt: s.attempt + 1, tries: s.tries + 1 })), OPEN_RETRY_DELAYS_MS[tries]);
    } else {
      this.setState({ held: true });
    }
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  private retry = () => this.setState((s) => ({ error: null, held: false, attempt: s.attempt + 1, tries: 0 }));

  render() {
    const { error, held, attempt } = this.state;
    if (error != null) {
      if (Platform.OS === 'web' && isAccessHandleError(error)) return held ? <OpenElsewhere onRetry={this.retry} /> : null;
      throw error;
    }
    return this.props.render(attempt);
  }
}

function OpenElsewhere({ onRetry }: { onRetry: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <Text accessibilityRole="header" style={[type.heading, { color: c.ink, textAlign: 'center' }]}>
        Plate & Bar is open in another tab. Close it, then retry.
      </Text>
      <Button label="Retry" onPress={onRetry} />
    </View>
  );
}
