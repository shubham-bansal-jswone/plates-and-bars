import { useRouter } from 'expo-router';
import { AboutScreen } from '../src/about/AboutScreen';

export default function About() {
  const router = useRouter();
  return <AboutScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
