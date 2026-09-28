import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert as NativeAlert, StyleSheet, View } from 'react-native';

import { LiveAlertBanner } from '@/components/map/LiveAlertBanner';
import { Banner } from '@/components/ui/Banner';
import { Spacing } from '@/constants/theme';
import { formatClockTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useFarm } from '@/stores/FarmDataContext';

/**
 * Every app-wide notice in one column, in order of urgency: live alert, load
 * or session error, silenced collars, offline profile, demo mode. It sits in
 * the layout flow above each screen's header, so banners can never overlap
 * each other, a header or content. Each is one compact row (details open with
 * a tap) so even three notices leave room for the map on a small phone.
 */
export function BannerStack() {
  const router = useRouter();
  const profileIsFallback = useAuthStore((s) => s.profileIsFallback);
  const demoMode = useAuthStore((s) => s.demoMode);
  const { liveAlert, dismissLiveAlert, loadError, collarsMutedUntil, setCollarsMuted } = useFarm();
  const [unmuting, setUnmuting] = useState(false);

  const unmute = async () => {
    try {
      setUnmuting(true);
      await setCollarsMuted(0);
    } catch (err) {
      NativeAlert.alert('Could not unmute collars', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUnmuting(false);
    }
  };

  const openLiveAlert = () => {
    if (!liveAlert) return;
    const livestockId = liveAlert.livestock_id;
    dismissLiveAlert();
    if (livestockId) router.push({ pathname: '/livestock/[id]', params: { id: livestockId } });
    else router.push('/(tabs)/alerts');
  };

  const any = Boolean(liveAlert || loadError || collarsMutedUntil || profileIsFallback || demoMode);
  if (!any) return null;

  return (
    <View style={styles.stack}>
      {liveAlert ? (
        <LiveAlertBanner alert={liveAlert} onNavigate={openLiveAlert} onDismiss={dismissLiveAlert} compact />
      ) : null}
      {loadError ? (
        <Banner
          tone="warning"
          icon="cloud-alert"
          compact
          title="Could not refresh farm data"
          message={`Showing the last data received. Check your signal.\n${loadError}`}
        />
      ) : null}
      {collarsMutedUntil ? (
        <Banner
          tone="warning"
          icon="volume-off"
          compact
          title={`Collars silenced until ${formatClockTime(collarsMutedUntil)}`}
          message="Collars will not beep at animals. Fence alerts still reach this app."
          actionLabel={unmuting ? 'Unmuting…' : 'Unmute'}
          actionBusy={unmuting}
          onAction={() => void unmute()}
        />
      ) : null}
      {profileIsFallback ? (
        <Banner
          tone="info"
          icon="account-alert-outline"
          compact
          title="Working offline"
          message="Your account details could not be loaded, so admin tools are hidden until the connection returns."
        />
      ) : null}
      {demoMode ? (
        <Banner
          tone="offline"
          compact
          title="Demo mode – not connected"
          message="Nothing you do here is saved or shared."
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
});
