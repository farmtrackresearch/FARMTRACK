import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Shadows, Spacing } from '@/constants/theme';

export type PositionChipState = {
  kind: 'off' | 'denied' | 'finding' | 'inside' | 'none' | 'near' | 'breach';
  label: string;
};

const LOOK: Record<PositionChipState['kind'], { bg: string; fg: string; icon: IconName }> = {
  off: { bg: Colors.surface, fg: Colors.primaryDark, icon: 'crosshairs' },
  denied: { bg: Colors.surface, fg: Colors.warningInk, icon: 'crosshairs-off' },
  finding: { bg: Colors.surface, fg: Colors.textSecondary, icon: 'crosshairs-question' },
  inside: { bg: Colors.successSoft, fg: Colors.successInk, icon: 'crosshairs-gps' },
  none: { bg: Colors.surface, fg: Colors.textSecondary, icon: 'crosshairs-gps' },
  near: { bg: Colors.warningInk, fg: Colors.textInverse, icon: 'alert-outline' },
  breach: { bg: Colors.critical, fg: Colors.textInverse, icon: 'alert-octagon-outline' },
};

/** "Check my position" switch that also reports the result. Its own look, never the livestock alarm. */
export function PositionChip({ state, on, onToggle }: { state: PositionChipState; on: boolean; onToggle: () => void }) {
  const look = LOOK[state.kind];
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Check my position against fences"
      accessibilityValue={{ text: state.label }}
      style={({ pressed }) => [styles.chip, { backgroundColor: look.bg }, pressed && { opacity: 0.85 }]}>
      <MaterialCommunityIcons name={look.icon} size={18} color={look.fg} />
      <Text
        variant="captionStrong"
        color={look.fg}
        numberOfLines={2}
        style={styles.text}
        maxFontSizeMultiplier={A11y.controlFontScale}>
        {state.label}
      </Text>
      {on ? <MaterialCommunityIcons name="close" size={16} color={look.fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: Spacing.sm,
    minHeight: A11y.minTouchTarget,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    ...Shadows.raised,
  },
  text: { flexShrink: 1 },
});
