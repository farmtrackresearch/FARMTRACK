import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import type { Alert, AlertType } from '@/types/database';
import { timeAgo } from '@/lib/utils';

function durationLabel(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins < 1) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function alertMeta(type: AlertType) {
  switch (type) {
    case 'boundary_breach':
      return {
        color: Colors.critical,
        soft: Colors.criticalSoft,
        icon: 'alert' as const,
        section: 'critical' as const,
      };
    case 'low_battery':
      return {
        color: Colors.warning,
        soft: Colors.warningSoft,
        icon: 'battery-alert' as const,
        section: 'warning' as const,
      };
    case 'approach_warning':
      return {
        color: Colors.caution,
        soft: Colors.warningSoft,
        icon: 'alert-outline' as const,
        section: 'warning' as const,
      };
    case 'stationary':
      return {
        color: Colors.warning,
        soft: Colors.warningSoft,
        icon: 'map-marker' as const,
        section: 'warning' as const,
      };
    default:
      return {
        color: Colors.info,
        soft: Colors.infoSoft,
        icon: 'information' as const,
        section: 'info' as const,
      };
  }
}

export function AlertCard({
  alert,
  onPress,
}: {
  alert: Alert;
  onPress?: () => void;
}) {
  const meta = alertMeta(alert.alert_type);
  const isActiveBreach = alert.alert_type === 'boundary_breach' && alert.status === 'unresolved';
  const isResolvedBreach = alert.alert_type === 'boundary_breach' && alert.status === 'resolved';

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

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isActiveBreach && styles.cardActiveBreach,
        { opacity: pressed ? 0.94 : 1 },
      ]}>
      <View style={[styles.accent, { backgroundColor: meta.color }]} />
      <View style={[styles.iconWrap, { backgroundColor: meta.color }]}>
        <MaterialCommunityIcons name={meta.icon} size={18} color="#fff" />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {alert.title}
          </Text>
          {isActiveBreach ? <Badge label="ACTIVE" tone="critical" /> : null}
        </View>
        {alert.description ? (
          <Text style={styles.desc} numberOfLines={2}>
            {alert.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.time}>{timeAgo(alert.created_at)}</Text>
          {breachDurationLabel ? (
            <Text style={[styles.time, isActiveBreach && styles.durationActive]}>
              {' '}
              · {isActiveBreach ? 'outside' : 'was outside'} {breachDurationLabel}
            </Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingRight: Spacing.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    ...Shadows.card,
  },
  cardActiveBreach: {
    backgroundColor: Colors.criticalSoft,
    borderWidth: 1.5,
    borderColor: Colors.critical,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  durationActive: {
    color: Colors.critical,
    fontWeight: '800',
  },
  accent: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: Spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  body: {
    flex: 1,
    paddingRight: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  desc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  time: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
  },
});
