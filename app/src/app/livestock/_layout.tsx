import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';

/** Every livestock screen draws its own AppHeader (same pattern as the tabs). */
export default function LivestockLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    />
  );
}
