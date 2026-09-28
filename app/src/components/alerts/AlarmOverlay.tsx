import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';
import { useAlarm } from '@/hooks/useAlarm';

/**
 * Full-screen alarm for the most urgent active alarm. Mounted in the root
 * layout so it covers every screen. Solid red (breach) or dark amber
 * (warning) with large white type, readable in sunlight. Acknowledging stops
 * that animal's alarm only; others stay queued behind it.
 */
export function AlarmOverlay() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeAlarm, alarms, dismissAlarm, dismissAllAlarms } = useAlarm();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!activeAlarm || activeAlarm.severity !== 'breach') {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 450, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [activeAlarm, pulse]);

  if (!activeAlarm) return null;

  const isBreach = activeAlarm.severity === 'breach';
  const bg = isBreach ? Colors.critical : Colors.warningInk;
  const icon = isBreach ? 'alert-octagon' : 'alert';
  const header = isBreach ? 'Fence breach alarm' : 'Fence proximity warning';
  const others = alarms.length - 1;
  const { sourceId } = activeAlarm;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: bg }]}
      accessibilityViewIsModal
      accessibilityLiveRegion="assertive">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        bounces={false}>
        <View style={styles.top}>
          <View style={styles.labelRow}>
            <View style={styles.labelPill}>
              <Text variant="overline" color="inverse" maxFontSizeMultiplier={A11y.controlFontScale}>
                {header}
              </Text>
            </View>
            {others > 0 ? (
              <Text variant="captionStrong" color="inverse" maxFontSizeMultiplier={A11y.controlFontScale}>
                +{others} more waiting
              </Text>
            ) : null}
          </View>

          <View style={styles.iconWrap}>
            <Animated.View style={[styles.iconRing, { transform: [{ scale: pulse }] }]} />
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name={icon} size={52} color={bg} />
            </View>
          </View>

          <Text variant="display" color="inverse" align="center" style={styles.title} accessibilityRole="header">
            {activeAlarm.title}
          </Text>
          <Text variant="body" color="inverse" align="center" style={styles.message}>
            {activeAlarm.message}
          </Text>

          {activeAlarm.fenceName ? (
            <View style={styles.chip}>
              <MaterialCommunityIcons name="fence" size={16} color={Colors.textInverse} />
              <Text variant="captionStrong" color="inverse" numberOfLines={1} style={styles.chipText}>
                {activeAlarm.fenceName}
              </Text>
            </View>
          ) : null}
          {activeAlarm.silenced ? (
            <View style={styles.chip}>
              <MaterialCommunityIcons name="volume-off" size={16} color={Colors.textInverse} />
              <Text variant="captionStrong" color="inverse" style={styles.chipText}>
                Sound stopped after 5 minutes. The animal is still outside.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => dismissAlarm(sourceId)}
            accessibilityRole="button"
            accessibilityLabel="Acknowledge alarm"
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={24} color={bg} />
            <Text variant="title" color={bg} maxFontSizeMultiplier={A11y.controlFontScale}>
              Acknowledge
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              dismissAlarm(sourceId);
              router.push({ pathname: '/livestock/[id]', params: { id: sourceId } });
            }}
            accessibilityRole="button"
            accessibilityLabel="View animal"
            style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: Colors.onDarkPressed }]}>
            <MaterialCommunityIcons name="cow" size={22} color={Colors.textInverse} />
            <Text variant="button" color="inverse" maxFontSizeMultiplier={A11y.controlFontScale}>
              View animal
            </Text>
          </Pressable>
          {others > 0 ? (
            // With several animals out at once, one tap clears every alarm so
            // the farmer can reach the app (e.g. Emergency Disable).
            <Pressable
              onPress={dismissAllAlarms}
              accessibilityRole="button"
              accessibilityLabel={`Acknowledge all ${alarms.length} alarms`}
              style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: Colors.onDarkPressed }]}>
              <MaterialCommunityIcons name="check-all" size={22} color={Colors.textInverse} />
              <Text variant="button" color="inverse" maxFontSizeMultiplier={A11y.controlFontScale}>
                Acknowledge all ({alarms.length})
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 200, elevation: 200 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.xxxl,
  },
  top: { alignItems: 'center', gap: Spacing.lg },
  labelRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  labelPill: {
    backgroundColor: Colors.onDark,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  iconWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg },
  iconRing: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: Colors.onDarkPressed,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: Spacing.sm },
  message: { fontSize: 17, lineHeight: 25 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: '100%',
    backgroundColor: Colors.onDark,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chipText: { flexShrink: 1 },
  actions: { gap: Spacing.md },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 60,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.textInverse,
  },
});
