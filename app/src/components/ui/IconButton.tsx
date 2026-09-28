import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Shadows } from '@/constants/theme';

type Variant = 'surface' | 'onDark' | 'plain' | 'tinted' | 'danger' | 'outlined' | 'dangerOutlined';

const LOOK: Record<Variant, { bg: string; pressed: string; icon: string }> = {
  /** White, raised: floating on the map. */
  surface: { bg: Colors.surface, pressed: Colors.surfaceSunken, icon: Colors.text },
  /** Translucent white on the dark header. */
  onDark: { bg: Colors.onDark, pressed: Colors.onDarkPressed, icon: Colors.textInverse },
  plain: { bg: 'transparent', pressed: Colors.surfaceSunken, icon: Colors.textSecondary },
  tinted: { bg: Colors.primarySoft, pressed: Colors.border, icon: Colors.primaryDark },
  danger: { bg: Colors.criticalSoft, pressed: Colors.border, icon: Colors.critical },
  outlined: { bg: Colors.surface, pressed: Colors.surfaceSunken, icon: Colors.primary },
  dangerOutlined: { bg: Colors.surface, pressed: Colors.criticalSoft, icon: Colors.critical },
};

type Props = {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  variant?: Variant;
  shape?: 'circle' | 'rounded';
  /** Visual size; the touch target is never below 44. */
  size?: number;
  iconSize?: number;
  color?: string;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  shape = 'circle',
  size = A11y.minTouchTarget,
  iconSize = 22,
  color,
  disabled,
  selected,
  style,
}: Props) {
  const look = LOOK[variant];
  const slop = Math.max(0, (A11y.minTouchTarget - size) / 2);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={slop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      style={({ pressed }) => [
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: shape === 'circle' ? size / 2 : Radius.sm,
          backgroundColor: pressed ? look.pressed : look.bg,
        },
        variant === 'surface' && Shadows.raised,
        variant === 'outlined' && styles.outlined,
        variant === 'dangerOutlined' && styles.dangerOutlined,
        disabled && styles.disabled,
        style,
      ]}>
      <MaterialCommunityIcons name={icon} size={iconSize} color={color ?? look.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  outlined: { borderWidth: 1, borderColor: Colors.borderStrong },
  dangerOutlined: { borderWidth: 1.5, borderColor: Colors.critical },
});
