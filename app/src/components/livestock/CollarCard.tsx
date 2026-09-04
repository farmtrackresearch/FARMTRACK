import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlertBanner } from '@/components/ui/AlertBanner';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { batteryColor, batteryTone, timeAgo } from '@/lib/utils';
import type { Collar, Livestock } from '@/types/database';

type Props = {
  animal: Livestock;
  collar?: Collar | null;
  onPress?: () => void;
  compact?: boolean;
};

export function CollarCard({ animal, collar, onPress, compact }: Props) {
  const battery = collar?.battery_level ?? 0;
  const tone = batteryTone(battery);
  const color = batteryColor(battery);
  const isCritical = tone === 'critical';

  const iconBg =
    tone === 'critical'
      ? Colors.criticalSoft
      : tone === 'warning'
        ? Colors.warningSoft
        : Colors.successSoft;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isCritical && styles.criticalBorder,
        pressed && { opacity: 0.94 },
      ]}>
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name="cow" size={22} color={color} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.name}>{animal.name}</Text>
          <Text style={styles.sub}>
            {collar?.connection_type ?? 'Unpaired'}
            {collar ? `  ·  ID: ${collar.device_hardware_id}` : ''}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.battery, { color }]}>{battery}%</Text>
          {!compact ? (
            <MaterialCommunityIcons
              name="signal-cellular-3"
              size={16}
              color={color}
              style={{ marginTop: 2 }}
            />
          ) : (
            <Text style={[styles.ago, { color }]}>{timeAgo(collar?.last_ping_at)}</Text>
          )}
        </View>
      </View>

      <ProgressBar progress={battery} color={color} style={{ marginTop: 12 }} height={6} />

      {!compact && collar ? (
        <>
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Signal</Text>
              <Text style={styles.gridValue}>{collar.signal_strength}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Firmware</Text>
              <Text style={styles.gridValue}>{collar.firmware_version}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Last Sync</Text>
              <Text style={styles.gridValue}>{timeAgo(collar.last_ping_at)}</Text>
            </View>
          </View>
          {isCritical ? (
            <View style={{ marginTop: Spacing.md }}>
              <AlertBanner tone="critical" title="Critical: Charge collar immediately" />
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    ...Shadows.card,
  },
  criticalBorder: {
    borderLeftWidth: 4,
    borderLeftColor: Colors.critical,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  meta: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  sub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
  },
  battery: {
    fontSize: 16,
    fontWeight: '700',
  },
  ago: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
  },
  gridItem: {
    flex: 1,
    alignItems: 'center',
  },
  divider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  gridLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
});
