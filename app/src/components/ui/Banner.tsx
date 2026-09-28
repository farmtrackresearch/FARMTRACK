import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { IconName, Tone, ToneColors } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';

const DEFAULT_ICON: Record<Tone, IconName> = {
  critical: 'alert-octagon-outline',
  warning: 'alert-outline',
  info: 'information-outline',
  success: 'check-circle-outline',
  neutral: 'information-outline',
  offline: 'cloud-off-outline',
};

type Props = {
  tone: Tone;
  title: string;
  message?: string | null;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Shows a spinner on the action and blocks it. */
  actionBusy?: boolean;
  onDismiss?: () => void;
  /** Compact: one row; the message opens with a tap on the banner. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Inline notice. App-wide notices all go through one BannerStack, never floating over content. */
export function Banner({
  tone,
  title,
  message,
  icon,
  actionLabel,
  onAction,
  actionBusy,
  onDismiss,
  compact,
  style,
}: Props) {
  const c = ToneColors[tone];
  const urgent = tone === 'critical' || tone === 'warning';
  const expandable = Boolean(compact && message);
  const [expanded, setExpanded] = useState(false);
  const showMessage = Boolean(message) && (!compact || expanded);

  const text = (
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text variant="captionStrong" color={c.ink} numberOfLines={compact && !expanded ? 2 : undefined} style={styles.title}>
          {title}
        </Text>
        {expandable ? (
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.ink} />
        ) : null}
      </View>
      {showMessage ? (
        <Text variant="caption" color="text">
          {message}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View
      style={[styles.wrap, compact && styles.compact, { backgroundColor: c.soft, borderLeftColor: c.color }, style]}
      accessibilityRole={urgent ? 'alert' : undefined}
      accessibilityLiveRegion={urgent ? 'polite' : 'none'}>
      <MaterialCommunityIcons name={icon ?? DEFAULT_ICON[tone]} size={20} color={c.color} />
      {expandable ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${expanded ? 'Hide details' : 'Show details'}`}
          accessibilityState={{ expanded }}
          style={styles.bodyPress}>
          {text}
        </Pressable>
      ) : (
        <View style={styles.bodyPress}>{text}</View>
      )}
      {actionLabel && onAction ? (
        <Pressable
          onPress={actionBusy ? undefined : onAction}
          disabled={actionBusy}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ busy: Boolean(actionBusy) }}
          style={({ pressed }) => [styles.action, { borderColor: c.color }, pressed && { backgroundColor: Colors.surface }]}>
          {actionBusy ? <ActivityIndicator size="small" color={c.color} /> : null}
          <Text variant="captionStrong" color={c.ink} numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <IconButton icon="close" size={32} iconSize={18} onPress={onDismiss} accessibilityLabel="Dismiss" color={c.ink} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderLeftWidth: 4,
  },
  compact: { minHeight: 40, paddingVertical: Spacing.xs },
  body: { gap: 2 },
  bodyPress: { flex: 1, minWidth: 0, minHeight: 32, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title: { flexShrink: 1 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
