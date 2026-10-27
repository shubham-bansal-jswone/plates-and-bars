import { useRouter } from 'expo-router';
import { Button } from '../components/ui';

/** "Exercise library" entry for the Add-exercise sheet (the Workout start view mounts it in the workout-session PR); opens the library route. `onBeforeOpen` lets a sheet close itself first. */
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
