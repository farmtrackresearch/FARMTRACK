import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { IconName, StatusMeta, statusKey, Tone, ToneColors } from '@/components/ui/tones';
import { A11y, Radius, Spacing } from '@/constants/theme';
import type { AnimalStatus } from '@/types/database';

type BadgeProps = {
  label: string;
  tone?: Tone;
  /** Small dot in the tone colour before the label. */
  dot?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
};

/** Short uppercase tag such as ACTIVE, OFFLINE or EDITING. */
export function Badge({ label, tone = 'neutral', dot, icon, style }: BadgeProps) {
  const c = ToneColors[tone];
  return (
    <View style={[styles.pill, styles.badge, { backgroundColor: c.soft }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: c.color }]} /> : null}
      {icon ? <MaterialCommunityIcons name={icon} size={12} color={c.color} /> : null}
      <Text variant="overline" color={c.ink} numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
        {label}
      </Text>
    </View>
  );
}

type StatusProps = {
  status: AnimalStatus;
  /** Newest fix is older than the stale limit: shown as "No recent fix". */
  stale?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Animal state pill: icon + words + colour, identical on every screen. */
export function StatusPill({ status, stale, style }: StatusProps) {
  const meta = StatusMeta[statusKey(status, stale)];
  return (
    <View
      style={[styles.pill, styles.status, { backgroundColor: meta.soft }, style]}
      accessibilityLabel={`Status: ${meta.label}`}>
      <MaterialCommunityIcons name={meta.icon} size={14} color={meta.color} />
      <Text variant="captionStrong" color={meta.ink} numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
        {meta.label}
      </Text>
    </View>
  );
}

/** Round count bubble, e.g. section counts. */
export function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: Tone }) {
  const c = ToneColors[tone];
  return (
    <View style={[styles.count, { backgroundColor: c.soft }]}>
      <Text variant="captionStrong" color={c.ink} maxFontSizeMultiplier={A11y.controlFontScale}>
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    flexShrink: 1,
  },
  badge: {
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  status: {
    gap: Spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: Spacing.xs,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
