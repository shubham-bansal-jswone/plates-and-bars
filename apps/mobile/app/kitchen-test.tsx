import { useRouter } from 'expo-router';
import { useDb } from '../src/db/lockedDb';
import { KitchenTestScreen } from '../src/screens/KitchenTestScreen';

export default function KitchenTest() {
  const router = useRouter();
  return <KitchenTestScreen db={useDb()} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
