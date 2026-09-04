import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

export type AlertBannerTone = 'critical' | 'warning' | 'info' | 'success';

const TONE_STYLE: Record<AlertBannerTone, { bg: string; fg: string; icon: string }> = {
  critical: { bg: Colors.criticalSoft, fg: Colors.critical, icon: 'alert-decagram' },
  warning: { bg: Colors.warningSoft, fg: Colors.warning, icon: 'alert-circle-outline' },
  info: { bg: Colors.infoSoft, fg: Colors.info, icon: 'information-outline' },
  success: { bg: Colors.successSoft, fg: Colors.success, icon: 'check-circle-outline' },
};

type Props = {
  tone: AlertBannerTone;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Generic inline banner for in-page warnings/confirmations — for a floating over-the-map toast, see LiveAlertBanner. */
export function AlertBanner({ tone, title, message, actionLabel, onAction }: Props) {
  const t = TONE_STYLE[tone];
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <MaterialCommunityIcons
        name={t.icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
        size={22}
        color={t.fg}
      />
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.fg }]}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} style={styles.actionBtn}>
            <Text style={[styles.actionText, { color: t.fg }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  body: { flex: 1 },
  title: { ...Typography.h3, fontSize: 15 },
  message: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.text,
    marginTop: 2,
  },
  actionBtn: { marginTop: Spacing.xs },
  actionText: { ...Typography.label },
});
