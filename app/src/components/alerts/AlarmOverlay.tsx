import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useAlarm } from '@/hooks/useAlarm';

export function AlarmOverlay() {
  const insets = useSafeAreaInsets();
  const { activeAlarm, dismissAlarm } = useAlarm();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!activeAlarm || activeAlarm.severity !== 'breach') {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [activeAlarm, pulse]);

  if (!activeAlarm) return null;

  const isBreach = activeAlarm.severity === 'breach';
  const bg = isBreach ? Colors.critical : Colors.warning;
  const icon = isBreach ? 'alert-decagram' : 'alert-circle-outline';
  const header = isBreach ? 'FENCE BREACH ALARM' : 'FENCE PROXIMITY WARNING';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { paddingTop: insets.top }]}>
      <Animated.View
        style={[
          styles.container,
          { backgroundColor: bg, transform: [{ scale: isBreach ? pulse : 1 }] },
        ]}>
        <View style={styles.headerRow}>
          <View style={[styles.iconBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <MaterialCommunityIcons name={icon} size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{header}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {activeAlarm.title}
            </Text>
          </View>
        </View>

        <Text style={styles.message} numberOfLines={3}>
          {activeAlarm.message}
        </Text>

        {activeAlarm.fenceName ? (
          <View style={styles.fenceRow}>
            <MaterialCommunityIcons name="vector-polygon" size={14} color="rgba(255,255,255,0.9)" />
            <Text style={styles.fenceName}>{activeAlarm.fenceName}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable onPress={() => void dismissAlarm()} style={[styles.btn, styles.btnPrimary]}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color={bg} />
            <Text style={[styles.btnText, { color: bg }]}>Acknowledge</Text>
          </Pressable>
          <Pressable
            onPress={() => void dismissAlarm()}
            style={[styles.btn, styles.btnGhost]}
            hitSlop={8}>
            <Text style={styles.btnTextGhost}>Dismiss</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  container: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadows.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  message: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  fenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  fenceName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#fff',
  },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  btnTextGhost: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
