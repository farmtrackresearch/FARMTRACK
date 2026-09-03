import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import { AlarmProvider } from '@/hooks/useAlarm';
import { FarmDataProvider } from '@/stores/FarmDataContext';
import { useAuthStore } from '@/stores/authStore';

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { loading, profile, initialize } = useAuthStore();

  useEffect(() => {
    void initialize().finally(() => {
      SplashScreen.hideAsync();
    });
  }, [initialize]);

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    const signedIn = Boolean(profile);

    if (!signedIn && !inAuth) {
      router.replace('/(auth)/login');
    } else if (signedIn && inAuth) {
      router.replace('/(tabs)');
    }
  }, [loading, profile, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryDark }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  // Keep the native splash screen up (AuthGate hides it once auth also resolves).
  // Poppins is opt-in per element via the Typography tokens in constants/theme.ts —
  // there's no reliable RN-wide "default font" hook, and mutating Text.defaultProps
  // silently no-ops for any <Text style={...}> (i.e. almost all of them), so it
  // isn't worth the risk of a global side effect that doesn't actually do anything.
  if (!fontsLoaded) return null;

  return (
    <AlarmProvider>
      <FarmDataProvider>
        <StatusBar style="light" />
        <AuthGate>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="livestock" options={{ presentation: 'card' }} />
          </Stack>
        </AuthGate>
      </FarmDataProvider>
    </AlarmProvider>
  );
}
