import { ResultsView } from '../components/ResultsView';
import { Button, H1, Hint, Page } from '../components/ui';
import { useRouter } from 'expo-router';
import { useProfile } from '../state/ProfileProvider';

/** Targets tab: `calcTargets` output for the stored profile, with the setup notes. */
export function TargetsScreen() {
  const { profile, markCleared } = useProfile();
  const router = useRouter();
  if (!profile) {
    return (
      <Page>
        <H1>Your setup</H1>
        <Hint>Answer a few questions and the app works out your calorie burn and targets.</Hint>
        <Button label="Start setup" onPress={() => router.replace('/setup' as never)} />
      </Page>
    );
  }
  return (
    <Page>
      <ResultsView profile={profile} onCleared={profile.cleared ? undefined : markCleared} />
    </Page>
  );
}
