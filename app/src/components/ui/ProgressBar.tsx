import { StyleSheet, View, ViewStyle } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

type Props = {
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  style?: ViewStyle;
};

export function ProgressBar({
  progress,
  color = Colors.primary,
  trackColor = Colors.border,
  height = 8,
  style,
}: Props) {
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <View style={[styles.track, { height, backgroundColor: trackColor, borderRadius: height }, style]}>
      <View
        style={{
          width: `${clamped}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: Colors.border,
    borderRadius: Radius.pill,
  },
});
