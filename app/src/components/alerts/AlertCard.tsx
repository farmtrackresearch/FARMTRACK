import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { IconName, Tone, ToneColors } from '@/components/ui/tones';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/lib/utils';
import type { Alert, AlertType } from '@/types/database';

function durationLabel(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins < 1) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

type AlertMeta = {
  tone: Tone;
  color: string;
  ink: string;
  soft: string;
  icon: IconName;
  section: 'critical' | 'warning' | 'info';
};

function meta(tone: Tone, icon: IconName, section: AlertMeta['section']): AlertMeta {
  const c = ToneColors[tone];
  return { tone, color: c.color, ink: c.ink, soft: c.soft, icon, section };
}

/** Colour, icon and list section for each alert type. Shared by the Alerts list and the live banner. */
export function alertMeta(type: AlertType): AlertMeta {
  switch (type) {
    case 'boundary_breach':
      return meta('critical', 'alert-octagon-outline', 'critical');
    case 'low_battery':
      return meta('warning', 'battery-alert-variant-outline', 'warning');
    case 'approach_warning':
      return meta('warning', 'alert-outline', 'warning');
    case 'stationary':
      return meta('warning', 'map-marker-alert-outline', 'warning');
    default:
      return meta('info', 'information-outline', 'info');
  }
}

type Props = {
  alert: Alert;
  /** Opens the related animal. Never resolves the alert. */
  onPress?: () => void;
  /** Shown as an explicit Resolve button on unresolved alerts. */
  onResolve?: () => void;
};

export const AlertCard = memo(function AlertCard({ alert, onPress, onResolve }: Props) {
  const m = alertMeta(alert.alert_type);
  const isActiveBreach = alert.alert_type === 'boundary_breach' && alert.status === 'unresolved';
  const isResolvedBreach = alert.alert_type === 'boundary_breach' && alert.status === 'resolved';
  const resolved = alert.status === 'resolved';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActiveBreach) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActiveBreach]);

  const breachDurationLabel = isActiveBreach
    ? durationLabel(now - new Date(alert.created_at).getTime())
    : isResolvedBreach && alert.resolved_at
      ? durationLabel(new Date(alert.resolved_at).getTime() - new Date(alert.created_at).getTime())
      : null;

  // The tappable area (opens the animal) and Resolve are siblings, so screen
  // readers can reach both; a button nested in a pressable is not focusable.
  return (
    <View style={[styles.card, isActiveBreach && styles.activeBreach]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityHint={onPress ? 'Opens the animal' : undefined}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <View style={[styles.iconBox, { backgroundColor: resolved ? Colors.surfaceSunken : m.soft }]}>
          <MaterialCommunityIcons name={m.icon} size={22} color={resolved ? Colors.textSecondary : m.color} />
        </View>
        <View style={styles.body}>
          <Text variant="heading" numberOfLines={2}>
            {alert.title}
          </Text>
          {alert.description ? (
            <Text variant="caption" color="secondary" numberOfLines={2}>
              {alert.description}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {isActiveBreach ? <Badge label="Active" tone="critical" dot /> : null}
            <Text variant="caption" color="secondary" style={styles.metaText}>
              {timeAgo(alert.created_at)}
              {breachDurationLabel ? (
                <Text
                  variant={isActiveBreach ? 'captionStrong' : 'caption'}
                  color={isActiveBreach ? Colors.criticalInk : 'secondary'}>
                  {' · '}
                  {isActiveBreach ? 'outside' : 'was outside'} {breachDurationLabel}
                </Text>
              ) : null}
            </Text>
          </View>
        </View>
        {onPress ? <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.textMuted} /> : null}
      </Pressable>
      {onResolve && alert.status === 'unresolved' ? (
        <Button
          label="Resolve"
          icon="check-all"
          variant="secondary"
          size="sm"
          onPress={onResolve}
          accessibilityLabel={`Resolve ${alert.title}`}
          style={styles.resolve}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  activeBreach: {
    backgroundColor: Colors.criticalSoft,
    borderWidth: 1.5,
    borderColor: Colors.critical,
  },
  main: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  pressed: { opacity: 0.9 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  metaText: { flexShrink: 1 },
  // Lines up with the text column (icon box 44 + gap 12).
  resolve: { alignSelf: 'flex-start', marginLeft: 44 + Spacing.md },
});
