import { useRouter } from 'expo-router';
import { useDb } from '../src/db/lockedDb';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { localDate } from '../src/setup/logic';

const now = () => new Date();

export default function Library() {
  const router = useRouter();
  const db = useDb();
  return <ExerciseLibraryScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} session={{ db, date: localDate(now()), now }} />;
}
