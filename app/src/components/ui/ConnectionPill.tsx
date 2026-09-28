import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';
import type { RealtimeHealth } from '@/hooks/useFarmData';

const LOOK: Record<RealtimeHealth, { label: string; icon: IconName; color: string }> = {
  live: { label: 'Live', icon: 'access-point', color: Colors.primarySoft },
  connecting: { label: 'Connecting…', icon: 'sync', color: Colors.accent },
  reconnecting: { label: 'Reconnecting…', icon: 'sync-alert', color: Colors.accent },
  offline: { label: 'Demo', icon: 'cloud-off-outline', color: Colors.textOnDarkMuted },
};

/** Realtime connection state, for the dark header. Icon + words, never colour alone. */
export function ConnectionPill({ health }: { health: RealtimeHealth }) {
  const look = LOOK[health];
  return (
    <View style={styles.pill} accessible accessibilityLabel={`Connection: ${look.label}`}>
      <MaterialCommunityIcons name={look.icon} size={14} color={look.color} />
      <Text variant="captionStrong" color="inverse" numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
        {look.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.onDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.onDarkBorder,
  },
});
