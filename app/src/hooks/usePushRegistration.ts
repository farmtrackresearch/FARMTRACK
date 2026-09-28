import { useEffect } from 'react';

import {
  ensureNotificationChannels,
  registerPushToken,
  requestNotificationPermission,
} from '@/lib/pushNotifications';
import { useAuthStore } from '@/stores/authStore';

/**
 * After sign-in (never at launch): create the Android channels, ask for
 * notification permission, then register this device for server pushes.
 * Demo mode stops after the permission step so the in-app siren can still
 * post local notifications; it never talks to Supabase.
 */
export function usePushRegistration() {
  const profileId = useAuthStore((s) => s.profile?.id ?? null);
  const demoMode = useAuthStore((s) => s.demoMode);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureNotificationChannels();
        const granted = await requestNotificationPermission();
        if (cancelled || !granted || demoMode) return;
        await registerPushToken();
      } catch (err) {
        console.warn('[push] setup failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, demoMode]);
}
