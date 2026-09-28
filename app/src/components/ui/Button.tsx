import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Shows a spinner in place of the icon and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

const LOOK: Record<ButtonVariant, { bg: string; pressed: string; fg: string; icon: string; border?: string }> = {
  primary: { bg: Colors.primary, pressed: Colors.primaryPressed, fg: Colors.textInverse, icon: Colors.textInverse },
  secondary: {
    bg: Colors.surface,
    pressed: Colors.surfaceSunken,
    fg: Colors.primaryDark,
    icon: Colors.primary,
    border: Colors.borderStrong,
  },
  destructive: {
    bg: Colors.surface,
    pressed: Colors.criticalSoft,
    fg: Colors.criticalInk,
    icon: Colors.critical,
    border: Colors.critical,
  },
  ghost: { bg: 'transparent', pressed: Colors.surfaceSunken, fg: Colors.primary, icon: Colors.primary },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  size = 'md',
  style,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const look = LOOK[variant];
  const inactive = disabled || loading;
  const small = size === 'sm';

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      hitSlop={small ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        small ? styles.sm : styles.md,
        { backgroundColor: pressed ? look.pressed : look.bg },
        look.border ? { borderWidth: variant === 'destructive' ? 1.5 : 1, borderColor: look.border } : null,
        inactive && styles.inactive,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={look.icon} />
      ) : icon ? (
        <MaterialCommunityIcons name={icon} size={small ? 18 : 20} color={look.icon} />
      ) : null}
      <View style={styles.labelWrap}>
        <Text
          variant="button"
          color={look.fg}
          align="center"
          numberOfLines={small ? 1 : 2}
          adjustsFontSizeToFit={small}
          minimumFontScale={0.85}
          maxFontSizeMultiplier={A11y.controlFontScale}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
  },
  md: {
    minHeight: A11y.minTouchTargetLarge,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  sm: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  labelWrap: { flexShrink: 1 },
  inactive: { opacity: 0.5 },
});
