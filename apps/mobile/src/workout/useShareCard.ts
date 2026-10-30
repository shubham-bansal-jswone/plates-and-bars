import { useRef, useState, type ComponentRef } from 'react';
import type { View } from 'react-native';
import { shareWorkoutImage } from './shareImage';
import type { ShareCardModel } from './shareModel';

/**
 * The share action of a summary picture, used by the completion panel and the History day view: the ref of the hidden
 * `ShareCard`, a busy flag, a result note, and `share(card)`. A second tap while one runs is ignored (two would race on
 * the same cache file); the note says when sharing is unavailable, the picture was saved, or it failed.
 */
export function useShareCard() {
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const sharing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const share = (card: ShareCardModel) => {
    if (sharing.current) return;
    sharing.current = true;
    setBusy(true);
    setNote(null);
    shareWorkoutImage(card, cardRef)
      .then(
        (res) => setNote(res === 'unavailable' ? 'Sharing is not available on this device.' : res === 'saved' ? 'Picture saved to your downloads.' : null),
        () => setNote('Could not share the picture. Try again.'),
      )
      .finally(() => {
        sharing.current = false;
        setBusy(false);
      });
  };
  return { cardRef, busy, note, share };
}
