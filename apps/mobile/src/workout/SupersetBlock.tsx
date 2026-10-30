import type { ComponentRef, ReactNode, Ref } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import { Button, Heading } from '../components/ui';
import { space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { listJoin } from './copy';

/**
 * A superset as one block: the brand bar down the left edge (as in History), a header, and its members. The bar is decoration; the words carry the meaning.
 * `open` shows "Round 2 of 3" (the round being done), collapsed shows "2 of 3 rounds done", and all rounds done shows a check and "Done".
 */
export function SupersetBlock({ names, rounds, open, onUngroup, headerRef, children }: { names: string[]; rounds: { total: number; done: number }; open: boolean; onUngroup: () => void; headerRef?: Ref<ComponentRef<typeof RNText>>; children: ReactNode }) {
  const c = useTheme();
  const finished = rounds.total > 0 && rounds.done === rounds.total;
  const status = finished ? 'Done' : open ? `Round ${rounds.done + 1} of ${rounds.total}` : `${rounds.done} of ${rounds.total} rounds done`;
  const who = listJoin(names);
  return (
    <View role="group" accessibilityLabel={`Superset: ${who}, ${finished ? 'done' : open ? `round ${rounds.done + 1} of ${rounds.total}` : `${rounds.done} of ${rounds.total} rounds done`}`} style={[styles.block, { borderLeftColor: c.brand }]}>
      <View style={styles.header}>
        <Heading level={2} ref={headerRef} style={[type.small, styles.title, { color: c.ink }]}>Superset</Heading>
        <View style={styles.status}>
          {finished ? (
            <Svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
              <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={c.brand} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          ) : null}
          <Text style={[type.caption, { color: finished ? c.ink : c.muted }]}>{status}</Text>
        </View>
        <Button label="Ungroup" a11yLabel={`Ungroup superset of ${who}`} kind="link" onPress={onUngroup} />
      </View>
      {children}
    </View>
  );
}

/** The member's letter in a 28px square: filled for the member whose set is up next. Hidden from screen readers (the letters are in the names and set labels). */
export function LetterBadge({ letter, upNext }: { letter: string; upNext?: boolean }) {
  const c = useTheme();
  return (
    <View aria-hidden style={[styles.badge, upNext ? { backgroundColor: c.brand, borderColor: c.brand } : { borderColor: c.outline }]}>
      <Text style={[type.small, { color: upNext ? c.onBrand : c.ink }]}>{letter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderLeftWidth: 4, paddingLeft: space.md, gap: space.sm },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md },
  title: { textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: '700' },
  status: { flex: 1, minWidth: 100, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  badge: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
