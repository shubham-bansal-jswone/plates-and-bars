import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDb } from '../src/db/lockedDb';
import { MEALS } from '../src/food/types';
import { RecipesScreen } from '../src/screens/RecipesScreen';

export default function Recipes() {
  const router = useRouter();
  const { meal } = useLocalSearchParams<{ meal?: string }>();
  return (
    <RecipesScreen
      db={useDb()}
      meal={MEALS.find((m) => m === meal)}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
