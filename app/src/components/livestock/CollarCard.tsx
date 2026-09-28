import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Text } from '@/components/ui/Text';
import { batteryVisual, ToneColors } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';
import { batteryLabel, isStale, timeAgo } from '@/lib/utils';
import type { Collar, Livestock } from '@/types/database';

type Props = {
  animal: Livestock;
  collar?: Collar | null;
  onPress?: () => void;
  compact?: boolean;
  /** Current time from useFarm(), so "offline" updates on the 30 s tick. */
  now: number;
};

export const CollarCard = memo(function CollarCard({ animal, collar, onPress, compact, now }: Props) {
  const battery = collar?.battery_level ?? null;
  const visual = batteryVisual(battery);
  const tone = ToneColors[visual.tone];
  const isCritical = visual.tone === 'critical';
  const offline = collar ? isStale(collar.last_ping_at, now) : false;
  const heard = timeAgo(collar?.last_ping_at, now);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${animal.name}, battery ${batteryLabel(battery)}${offline ? ', offline' : ''}`}
      style={({ pressed }) => [styles.card, isCritical && styles.critical, pressed && styles.pressed]}>
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: tone.soft }]}>
          <MaterialCommunityIcons name="cow" size={24} color={tone.color} />
        </View>
        <View style={styles.meta}>
          <View style={styles.nameRow}>
            <Text variant="heading" numberOfLines={1} style={styles.name}>
              {animal.name}
            </Text>
            {offline ? <Badge label="Offline" tone="offline" dot /> : null}
          </View>
          <Text variant="caption" color="secondary" numberOfLines={1}>
            {collar ? `${collar.connection_type} · ${collar.device_hardware_id}` : 'No collar paired'}
          </Text>
        </View>
        <View style={styles.right}>
          <View style={styles.batteryRow}>
            <MaterialCommunityIcons
              name={battery == null ? 'battery-unknown' : isCritical ? 'battery-alert-variant-outline' : 'battery-medium'}
              size={16}
              color={visual.bar}
            />
            <Text variant="heading" color={visual.ink} maxFontSizeMultiplier={A11y.controlFontScale}>
              {batteryLabel(battery)}
            </Text>
          </View>
          {compact ? (
            <Text variant="caption" color="secondary" numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
              {heard}
            </Text>
          ) : null}
        </View>
      </View>

      <ProgressBar
        progress={battery ?? 0}
        color={visual.bar}
        height={6}
        style={styles.bar}
        accessibilityLabel={`Battery ${batteryLabel(battery)}`}
      />

      {!compact && collar ? (
        <>
          <View style={styles.grid}>
            <GridItem label="Signal" value={collar.signal_strength} />
            <View style={styles.divider} />
            <GridItem label="Firmware" value={collar.firmware_version} />
            <View style={styles.divider} />
            <GridItem label="Last heard" value={heard} />
          </View>
          {isCritical ? (
            <Banner tone="critical" icon="battery-alert-variant-outline" title="Charge this collar now" compact />
          ) : null}
          {visual.tone === 'offline' ? (
            <Text variant="caption" color="secondary">
              Battery level unknown: this collar has no battery sensor fitted.
            </Text>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
});

function GridItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.gridItem}>
      <Text variant="caption" color="secondary" numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
        {label}
      </Text>
      <Text variant="captionStrong" numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  critical: { borderLeftWidth: 4, borderLeftColor: Colors.critical },
  pressed: { backgroundColor: Colors.surfaceAlt },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flexShrink: 1 },
  right: { alignItems: 'flex-end', maxWidth: '38%' },
  batteryRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { marginTop: -Spacing.xs },
  grid: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  gridItem: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: Spacing.xs, gap: 2 },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
});
