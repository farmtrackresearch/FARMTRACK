import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

/**
 * Bottom sheet docked to the bottom of the map (the tab bar sits below it in
 * the layout, so it never covers the bar). It shrinks, and its content
 * scrolls, before it would ever reach the controls above it.
 */
export function MapSheet({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sheet, style]}>
      <View style={styles.handle} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flexShrink: 1,
    // The header row always stays visible; only the list/body shrinks.
    minHeight: 72,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.md,
    ...Shadows.raised,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderStrong,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
});
