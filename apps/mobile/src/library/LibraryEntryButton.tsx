import { useRouter } from 'expo-router';
import { Button } from '../components/ui';

/** "Exercise library" entry for the Workout start view and the Add-exercise sheet; opens the library route. `onBeforeOpen` lets a sheet close itself first. */
export function LibraryEntryButton({ onBeforeOpen }: { onBeforeOpen?: () => void }) {
  const router = useRouter();
  return (
    <Button
      label="Exercise library"
      kind="ghost"
      onPress={() => {
        onBeforeOpen?.();
        router.push('/library' as never);
      }}
    />
  );
}
