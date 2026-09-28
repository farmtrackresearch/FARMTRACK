import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { CountBadge } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { IconName, Tone, ToneColors } from '@/components/ui/tones';
import { A11y, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  icon?: IconName;
  tone?: Tone;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ title, icon, tone = 'success', count, actionLabel, onAction, style }: Props) {
  return (
    <View style={[styles.row, style]} accessibilityRole="header">
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={ToneColors[tone].color} /> : null}
      <Text variant="title" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {count != null ? <CountBadge count={count} tone={tone} /> : null}
      <View style={styles.spacer} />
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
          <Text variant="captionStrong" color="primary" maxFontSizeMultiplier={A11y.controlFontScale}>
            {actionLabel}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={ToneColors.success.color} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  title: { flexShrink: 1, fontSize: 18, lineHeight: 24 },
  spacer: { flex: 1 },
  action: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
});
