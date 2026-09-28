import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  /** outlined: hairline border (default). raised: soft shadow, for floating UI. */
  variant?: 'outlined' | 'raised';
  /** Coloured left edge, e.g. an active breach. */
  accentColor?: string;
  padded?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function Card({
  children,
  style,
  onPress,
  onLongPress,
  variant = 'outlined',
  accentColor,
  padded = true,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const base = [
    styles.card,
    variant === 'raised' ? Shadows.raised : styles.outlined,
    padded && styles.padded,
    accentColor ? { borderLeftWidth: 4, borderLeftColor: accentColor } : null,
  ];

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [base, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
  },
  outlined: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  padded: { padding: Spacing.lg },
  pressed: { backgroundColor: Colors.surfaceAlt },
});
