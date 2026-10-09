import { useRouter } from 'expo-router';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';

export default function Library() {
  const router = useRouter();
  return <ExerciseLibraryScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
