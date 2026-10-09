import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { MealPlanScreen } from '../src/screens/MealPlanScreen';

export default function MealPlan() {
  const router = useRouter();
  return <MealPlanScreen db={useSQLiteContext()} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
