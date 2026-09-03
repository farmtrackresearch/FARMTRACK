import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Colors, Radius, Typography } from '@/constants/theme';

export type BadgeTone = 'critical' | 'warning' | 'info' | 'success' | 'neutral';

const TONE_COLORS: Record<BadgeTone, { bg: string; fg: string }> = {
  critical: { bg: Colors.criticalSoft, fg: Colors.critical },
  warning: { bg: Colors.warningSoft, fg: Colors.warning },
  info: { bg: Colors.infoSoft, fg: Colors.info },
  success: { bg: Colors.successSoft, fg: Colors.success },
  neutral: { bg: Colors.surfaceVariant, fg: Colors.textSecondary },
};

type Props = {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
};

export function Badge({ label, tone = 'neutral', style }: Props) {
  const { bg, fg } = TONE_COLORS[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  label: {
    ...Typography.label,
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
