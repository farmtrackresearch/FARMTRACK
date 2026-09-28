import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { StatusKey, StatusMeta } from '@/components/ui/tones';
import { Colors, MapPalette, Radius, Shadows, Spacing } from '@/constants/theme';

const ANIMALS: StatusKey[] = ['grazing', 'near_boundary', 'breach', 'resting', 'stale'];

/** Key for markers and fence lines. Opened from the map header; laid out in the overlay flow, never on top of controls. */
export function MapLegend() {
  return (
    <View style={styles.card} accessibilityLabel="Map legend">
      <Text variant="overline" color="secondary">
        Animals
      </Text>
      <View style={styles.grid}>
        {ANIMALS.map((key) => {
          const meta = StatusMeta[key];
          const stale = key === 'stale';
          return (
            <View key={key} style={styles.row}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: stale ? Colors.surface : meta.color, borderColor: stale ? meta.color : MapPalette.markerRing },
                ]}
              />
              <Text variant="caption" numberOfLines={1} style={styles.label}>
                {stale ? 'No fix for 3 min' : meta.label}
              </Text>
            </View>
          );
        })}
      </View>
      <Text variant="overline" color="secondary" style={styles.heading}>
        Fences
      </Text>
      <View style={styles.grid}>
        <View style={styles.row}>
          <View style={[styles.line, { backgroundColor: MapPalette.fenceStroke }]} />
          <Text variant="caption" numberOfLines={1} style={styles.label}>
            Fence
          </Text>
        </View>
        <View style={styles.row}>
          <View style={[styles.line, styles.dashed, { borderColor: MapPalette.warnStroke }]} />
          <Text variant="caption" numberOfLines={1} style={styles.label}>
            Warning edge
          </Text>
        </View>
        <View style={styles.row}>
          <View style={[styles.line, styles.dashed, { borderColor: MapPalette.inactiveStroke }]} />
          <Text variant="caption" numberOfLines={1} style={styles.label}>
            Switched off
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Shadows.raised,
  },
  heading: { marginTop: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md, rowGap: 2, marginTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minWidth: 118, minHeight: 22 },
  label: { flexShrink: 1 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  line: { width: 18, height: 4, borderRadius: 2 },
  dashed: { height: 0, borderTopWidth: 3, borderStyle: 'dashed', backgroundColor: 'transparent' },
});
