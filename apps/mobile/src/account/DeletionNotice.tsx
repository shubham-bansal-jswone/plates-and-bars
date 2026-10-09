import { useContext, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Note } from '../components/ui';
import { SyncContext } from '../sync/SyncProvider';
import { DATA_COPY as t } from './copy';

/** Tells once, on the screen the app lands on after a deletion, what was deleted; clears itself when that screen goes away. */
export function DeletionNotice() {
  const s = useContext(SyncContext);
  // Kept in state, so clearing the provider's copy on leaving does not blank the notice while it is still on screen.
  const [shown] = useState(s?.lastDeletion ?? null);
  const clear = s?.clearLastDeletion;
  // Only a notice that showed something clears it: one that unmounts with the wiped tree must not eat the message.
  useEffect(() => (shown ? clear : undefined), [shown, clear]);
  if (!shown) return null;
  return (
    <View style={{ padding: 16 }} accessibilityLiveRegion="polite">
      <Note>{shown.server ? t.noticeAll : t.noticeDevice}</Note>
    </View>
  );
}
