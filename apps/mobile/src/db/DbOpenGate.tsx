import { Component, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { Button, Heading } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** Waits before each automatic reload on web: about 2 s in all, in case the other tab is closing. */
export const OPEN_RETRY_DELAYS_MS = [250, 500, 1250] as const;
const TRIES_KEY = 'pb-db-open-tries';

/**
 * The web database keeps an exclusive OPFS access handle, so a second tab of the same origin cannot open it (#1232).
 * The browser's own message is logged inside wa-sqlite; what `SQLiteProvider` gets back is its "Invalid VFS state"
 * (measured in Chromium), so both count. Neither is expected for any other reason on web.
 */
export function isAccessHandleError(e: unknown): boolean {
  const text = `${(e as { name?: unknown } | null)?.name ?? ''} ${(e as { message?: unknown } | null)?.message ?? ''}`;
  return /access handle|NoModificationAllowedError|Invalid VFS state/i.test(text);
}

// Per tab, survives a reload. A failed open leaves expo-sqlite's web worker unusable for good ("Invalid VFS state" on every
// later call), so retrying means loading the page again, not remounting the provider.
function tries(): number {
  try {
    return Number(globalThis.sessionStorage?.getItem(TRIES_KEY)) || 0;
  } catch {
    return 0;
  }
}
function setTries(n: number) {
  try {
    if (n > 0) globalThis.sessionStorage?.setItem(TRIES_KEY, String(n));
    else globalThis.sessionStorage?.removeItem(TRIES_KEY);
  } catch {
    // storage blocked: the count restarts at each load, so the automatic retries repeat; the message still shows after the last one.
  }
}

/** Call once the database has opened: the next failure gets its full set of retries again. */
export function clearOpenRetries() {
  if (Platform.OS === 'web') setTries(0);
}

type State = { error: unknown; held: boolean };

/**
 * Wraps the SQLite provider. On web, an access-handle failure reloads the page a few times with a short back-off (the other tab
 * may be closing), then shows "open in another tab" with a Retry button. Any other error is rethrown, as before. Native is unchanged.
 */
export class DbOpenGate extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, held: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (Platform.OS !== 'web' || !isAccessHandleError(error)) return;
    const n = tries();
    if (n < OPEN_RETRY_DELAYS_MS.length) {
      this.timer = setTimeout(() => {
        setTries(n + 1);
        globalThis.location.reload();
      }, OPEN_RETRY_DELAYS_MS[n]);
    } else {
      this.setState({ held: true });
    }
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  private retry = () => {
    setTries(0);
    globalThis.location.reload();
  };

  render() {
    const { error, held } = this.state;
    if (error != null) {
      if (Platform.OS === 'web' && isAccessHandleError(error)) return held ? <OpenElsewhere onRetry={this.retry} /> : null;
      throw error;
    }
    return this.props.children;
  }
}

function OpenElsewhere({ onRetry }: { onRetry: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <Heading level={1} style={[type.heading, { color: c.ink, textAlign: 'center' }]}>
        Plate & Bar is open in another tab. Close it, then retry.
      </Heading>
      <Button label="Retry" onPress={onRetry} />
    </View>
  );
}
