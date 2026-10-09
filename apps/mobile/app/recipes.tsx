import { useRouter } from 'expo-router';
import { useDb } from '../src/db/lockedDb';
import { RecipesScreen } from '../src/screens/RecipesScreen';

export default function Recipes() {
  const router = useRouter();
  return <RecipesScreen db={useDb()} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} onKitchen={() => router.push('/kitchen-test')} />;
}
