import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { CollarCard } from '@/components/livestock/CollarCard';
import { AppHeader } from '@/components/ui/AppHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ConnectionPill } from '@/components/ui/ConnectionPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { Text } from '@/components/ui/Text';
import { IconName, Tone, ToneColors } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';
import { formatClockTime, isStale, timeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useFarm } from '@/stores/FarmDataContext';

const EMERGENCY_MUTE_MINUTES = 60;

export default function DashboardScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const {
    livestock,
    collars,
    locations,
    geofences,
    unresolvedAlerts,
    isAdmin,
    realtimeHealth,
    loading,
    collarsMutedUntil,
    setCollarsMuted,
    refresh,
    now,
  } = useFarm();
  const [muteBusy, setMuteBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fence state comes from the server (livestock.animal_status); alert rows
  // can be resolved by hand, so they are not used to count animals.
  const breach = livestock.filter((l) => l.animal_status === 'breach').length;
  const near = livestock.filter((l) => l.animal_status === 'near_boundary').length;
  const lowBattery = unresolvedAlerts.filter((a) => a.alert_type === 'low_battery').length;
  const stationary = unresolvedAlerts.filter((a) => a.alert_type === 'stationary').length;
  const needsAttention = breach + near + lowBattery + stationary;

  const collarsOnline = collars.filter((c) => !isStale(c.last_ping_at, now)).length;
  const activeFences = geofences.filter((g) => g.is_active).length;
  const newestFix = locations.reduce<string | null>(
    (newest, l) =>
      l.last_seen_at && (!newest || new Date(l.last_seen_at) > new Date(newest)) ? l.last_seen_at : newest,
    null
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const setMuted = async (minutes: number) => {
    try {
      setMuteBusy(true);
      await setCollarsMuted(minutes);
    } catch (err) {
      Alert.alert(
        minutes > 0 ? 'Could not mute collars' : 'Could not unmute collars',
        err instanceof Error ? err.message : 'Unknown error'
      );
    } finally {
      setMuteBusy(false);
    }
  };

  const confirmEmergencyDisable = () => {
    Alert.alert(
      'Silence all collars?',
      `Every collar stops beeping for ${EMERGENCY_MUTE_MINUTES} minutes, for example while you move the herd through a fence. ` +
        'Fence alerts still reach this app. Collars pick this up at their next report.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Silence ${EMERGENCY_MUTE_MINUTES} min`,
          style: 'destructive',
          onPress: () => void setMuted(EMERGENCY_MUTE_MINUTES),
        },
      ]
    );
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'This phone stops receiving fence alerts until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const roleLabel = profile?.role === 'admin' ? 'Admin' : 'Staff';

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      header={
        <AppHeader
          inScroll
          overline={`FarmTrack · ${roleLabel}`}
          title={profile?.farm_name ?? 'My Farm'}
          subtitle={newestFix ? `Newest collar position ${timeAgo(newestFix, now).toLowerCase()}` : 'No collar positions yet'}
          below={<ConnectionPill health={realtimeHealth} />}
          right={<IconButton icon="logout" variant="onDark" onPress={confirmSignOut} accessibilityLabel="Sign out" />}>
          <StatRow>
            <StatTile icon="cow" label="Total head" value={livestock.length} />
            <StatTile icon="fence" label="Active fences" value={activeFences} />
            <StatTile
              icon="access-point"
              label="Collars online"
              value={`${collarsOnline}/${collars.length}`}
              attention={collars.length > 0 && collarsOnline < collars.length}
            />
          </StatRow>
        </AppHeader>
      }>
      <View style={styles.actions}>
        <ActionTile
          icon="vector-polygon"
          tone="success"
          label="New fence"
          caption={isAdmin ? 'Draw a boundary on the map' : 'Admins only'}
          disabled={!isAdmin}
          onPress={() => router.push('/(tabs)/map?createFence=1')}
        />
        <ActionTile
          icon="volume-off"
          tone="critical"
          label={collarsMutedUntil ? 'Collars silenced' : 'Emergency Disable'}
          caption={
            collarsMutedUntil
              ? `Until ${formatClockTime(collarsMutedUntil)}. Fence alerts still reach this app.`
              : `Silence every collar for ${EMERGENCY_MUTE_MINUTES} min`
          }
          disabled={muteBusy || Boolean(collarsMutedUntil)}
          busy={muteBusy}
          onPress={confirmEmergencyDisable}
        />
      </View>

      <Card padded={false} style={styles.attnCard}>
        <View style={styles.attnHead}>
          <MaterialCommunityIcons
            name={needsAttention > 0 ? 'alert-circle-outline' : 'check-circle-outline'}
            size={22}
            color={needsAttention > 0 ? Colors.critical : Colors.primary}
          />
          <Text variant="title" style={styles.attnTitle}>
            Needs attention
          </Text>
          {needsAttention === 0 ? <Badge label="All clear" tone="success" /> : null}
        </View>
        <AttentionRow
          icon="alert-octagon-outline"
          tone="critical"
          title="Outside the fence"
          subtitle={`${breach} animal${breach === 1 ? '' : 's'} outside the fence`}
          count={breach}
          onPress={() => router.push('/(tabs)/map')}
        />
        <AttentionRow
          icon="alert-outline"
          tone="warning"
          title="Near the fence"
          subtitle={`${near} animal${near === 1 ? '' : 's'} close to the fence`}
          count={near}
          onPress={() => router.push('/(tabs)/map')}
        />
        <AttentionRow
          icon="battery-alert-variant-outline"
          tone="warning"
          title="Low battery"
          subtitle={`${lowBattery} collar${lowBattery === 1 ? '' : 's'} need charging`}
          count={lowBattery}
          onPress={() => router.push('/(tabs)/hardware')}
        />
        <AttentionRow
          icon="map-marker-alert-outline"
          tone="warning"
          title="Not moving"
          subtitle={`${stationary} animal${stationary === 1 ? '' : 's'} stationary for an hour`}
          count={stationary}
          onPress={() => router.push('/(tabs)/alerts')}
          last
        />
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title="Collar battery"
          icon="battery-heart-variant"
          actionLabel="View all"
          onAction={() => router.push('/(tabs)/hardware')}
        />
        {livestock.length === 0 ? (
          loading ? (
            <EmptyState scene={false} icon="sprout" title="Loading your farm…" />
          ) : (
            <EmptyState
              title="No animals yet"
              message="Power on a collar near the gateway, then pair it from the Hardware tab."
              actionLabel="Open Hardware"
              actionIcon="access-point"
              onAction={() => router.push('/(tabs)/hardware')}
            />
          )
        ) : (
          livestock
            .slice(0, 4)
            .map((animal) => (
              <CollarCard
                key={animal.id}
                animal={animal}
                collar={animal.collar}
                now={now}
                compact
                onPress={() => router.push(`/livestock/${animal.id}`)}
              />
            ))
        )}
      </View>

      {isAdmin ? (
        <ListRow
          leadingIcon="barn"
          title="Manage livestock"
          subtitle="Add, edit and pair animals"
          chevron
          onPress={() => router.push('/livestock')}
          accessibilityLabel="Manage livestock"
        />
      ) : null}
    </Screen>
  );
}

function ActionTile({
  icon,
  tone,
  label,
  caption,
  onPress,
  disabled,
  busy,
}: {
  icon: IconName;
  tone: Tone;
  label: string;
  caption: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const c = ToneColors[tone];
  const destructive = tone === 'critical';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={caption}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.tile,
        destructive && styles.tileDestructive,
        pressed && { backgroundColor: destructive ? Colors.criticalSoft : Colors.surfaceAlt },
        disabled && styles.tileDisabled,
      ]}>
      <View style={[styles.tileIcon, { backgroundColor: c.soft }]}>
        <MaterialCommunityIcons name={icon} size={22} color={c.color} />
      </View>
      <Text variant="heading" color={destructive ? c.ink : 'text'} numberOfLines={2}>
        {label}
      </Text>
      <Text variant="caption" color="secondary" numberOfLines={2} maxFontSizeMultiplier={A11y.controlFontScale}>
        {caption}
      </Text>
    </Pressable>
  );
}

function AttentionRow({
  icon,
  tone,
  title,
  subtitle,
  count,
  onPress,
  last,
}: {
  icon: IconName;
  tone: Tone;
  title: string;
  subtitle: string;
  count: number;
  onPress: () => void;
  last?: boolean;
}) {
  const active = count > 0;
  const c = ToneColors[active ? tone : 'neutral'];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${subtitle}`}
      style={({ pressed }) => [styles.attnRow, !last && styles.attnDivider, pressed && styles.attnPressed]}>
      <View style={[styles.attnIcon, { backgroundColor: c.soft }]}>
        <MaterialCommunityIcons name={icon} size={20} color={c.color} />
      </View>
      <View style={styles.attnText}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" color="secondary" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Text variant="stat" color={active ? c.ink : 'secondary'} maxFontSizeMultiplier={A11y.controlFontScale}>
        {count}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.md },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  tileDestructive: { borderWidth: 1.5, borderColor: Colors.critical },
  tileDisabled: { opacity: 0.55 },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  attnCard: { overflow: 'hidden' },
  attnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  attnTitle: { flexShrink: 1, fontSize: 18, lineHeight: 24 },
  attnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 64,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  attnDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  attnPressed: { backgroundColor: Colors.surfaceAlt },
  attnIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attnText: { flex: 1, minWidth: 0 },
  section: { gap: Spacing.md },
});
