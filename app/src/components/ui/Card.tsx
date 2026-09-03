import { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';

import { A11y, Colors, Radius, Shadows, Spacing, Typography } from '@/constants/theme';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accentColor?: string;
};

export function Card({ children, style, onPress, accentColor }: Props) {
  const content = (
    <View style={[styles.card, accentColor ? { borderLeftWidth: 4, borderLeftColor: accentColor } : null, style]}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadows.card,
  },
});

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'dangerOutline' | 'ghost' | 'outline';
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  style,
  disabled,
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'dangerOutline';
  const isOutline = variant === 'outline';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        btn.base,
        isPrimary && btn.primary,
        isDanger && btn.danger,
        isOutline && btn.outline,
        variant === 'ghost' && btn.ghost,
        pressed && { opacity: 0.88 },
        disabled && { opacity: 0.5 },
        style,
      ]}>
      {icon}
      <Text
        style={[
          btn.label,
          isPrimary && { color: Colors.textInverse },
          isDanger && { color: Colors.critical },
          isOutline && { color: Colors.text },
          variant === 'ghost' && { color: Colors.primary },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const btn = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: A11y.minTouchTargetLarge,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  danger: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.critical,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  outline: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  label: {
    ...Typography.button,
  },
});
