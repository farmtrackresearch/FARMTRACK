import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Button } from '@/components/ui/Button';
import { PastureScene } from '@/components/ui/Illustrations';
import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  message?: string;
  icon?: IconName;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  /** Pasture illustration above the text. Off for small inline states. */
  scene?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Friendly "nothing here yet" block with an optional next step. */
export function EmptyState({ title, message, icon, actionLabel, actionIcon, onAction, scene = true, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      {scene ? <PastureScene /> : null}
      {icon && !scene ? (
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name={icon} size={26} color={Colors.primary} />
        </View>
      ) : null}
      <Text variant="heading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="caption" color="secondary" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} icon={actionIcon} onPress={onAction} size="sm" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { maxWidth: 320 },
  action: { marginTop: Spacing.sm, alignSelf: 'center' },
});
