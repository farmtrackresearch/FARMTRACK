import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  style?: ViewStyle;
  colors?: readonly [string, string, ...string[]];
};

export function GradientHeader({
  title,
  subtitle,
  right,
  children,
  style,
  colors = [Colors.primaryDark, Colors.headerEnd],
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient colors={colors} style={[styles.wrap, { paddingTop: insets.top + 12 }, style]}>
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleBlock: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  title: {
    ...Typography.h1,
    color: Colors.textInverse,
    letterSpacing: -0.3,
  },
  subtitle: {
    ...Typography.bodyLarge,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
});

export function GlassStat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <View style={glass.card}>
      <Text style={glass.label}>{label}</Text>
      <Text style={[glass.value, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const glass = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
  },
  label: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 6,
    textAlign: 'center',
  },
  value: {
    ...Typography.h2,
    color: Colors.textInverse,
  },
});
