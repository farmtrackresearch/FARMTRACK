import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

type Props = {
  /** 0-100. */
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function ProgressBar({
  progress,
  color = Colors.primary,
  trackColor = Colors.surfaceSunken,
  height = 8,
  style,
  accessibilityLabel,
}: Props) {
  const clamped = Math.max(0, Math.min(100, progress));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      style={[styles.track, { height, backgroundColor: trackColor }, style]}>
      <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden', borderRadius: Radius.pill },
  fill: { height: '100%', borderRadius: Radius.pill },
});
