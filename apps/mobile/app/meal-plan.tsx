import { useRouter } from 'expo-router';
import { MealPlanScreen } from '../src/screens/MealPlanScreen';

export default function MealPlan() {
  const router = useRouter();
  return <MealPlanScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
