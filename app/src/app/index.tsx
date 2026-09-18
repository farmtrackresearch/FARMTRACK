import { Redirect } from 'expo-router';

import { useAuthStore } from '@/stores/authStore';

export default function Index() {
  const profile = useAuthStore((s) => s.profile);
  if (profile) return <Redirect href="/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
