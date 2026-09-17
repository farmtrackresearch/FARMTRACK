import { MaterialCommunityIcons } from '@expo/vector-icons';
import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { Colors, RANCH_REGION, Radius, Shadows, Spacing, Typography } from '@/constants/theme';

/**
 * Web stand-in for the map.
 *
 * FarmTrack ships to iOS and Android only. The map is rendered by MapLibre,
 * a native module with no browser build, so rather than degrade the map on
 * web this explains where to find it. Deliberately depends on no mapping
 * library — importing one here would pull a renderer back into the web bundle.
 *
 * The RanchMapHandle methods are implemented as no-ops so callers in
 * `map.tsx` need no platform checks.
 */
function RanchMapWebInner(
  { polygons, locations }: RanchMapProps,
  ref: React.ForwardedRef<RanchMapHandle>
) {
  useImperativeHandle(ref, () => ({
    fitToCoordinates: () => {},
    getCenter: () => RANCH_REGION,
  }));

  const fenceCount = polygons.length;
  const trackedCount = locations.filter((l) => l.latitude != null && l.longitude != null).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.iconRing}>
          <MaterialCommunityIcons name="cellphone-marker" size={30} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Open FarmTrack on your phone</Text>
        <Text style={styles.body}>
          The live map, geofence drawing and breach alerts run natively on iOS and Android. The
          browser build does not include the map renderer.
        </Text>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{fenceCount}</Text>
            <Text style={styles.statLabel}>{fenceCount === 1 ? 'fence' : 'fences'}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{trackedCount}</Text>
            <Text style={styles.statLabel}>
              {trackedCount === 1 ? 'animal tracked' : 'animals tracked'}
            </Text>
          </View>
        </View>

        <Text style={styles.note}>
          Everything else — livestock records, alerts and analytics — works here in the browser.
        </Text>
      </View>
    </View>
  );
}

const RanchMap = forwardRef<RanchMapHandle, RanchMapProps>(RanchMapWebInner);
RanchMap.displayName = 'RanchMap';
export default RanchMap;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
    padding: Spacing.lg,
  },
  card: {
    alignItems: 'center',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
    ...Shadows.card,
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.successSoft,
    marginBottom: Spacing.xs,
  },
  title: { ...Typography.h3, color: Colors.text, textAlign: 'center' },
  body: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  stat: { alignItems: 'center' },
  statNum: { ...Typography.h2, color: Colors.primary },
  statLabel: { ...Typography.caption, color: Colors.textMuted },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  note: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
