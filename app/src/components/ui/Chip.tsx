import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Coloured dot before the label (e.g. health status). */
  dotColor?: string;
  icon?: IconName;
  /** Full-width selectable row instead of a pill. */
  block?: boolean;
  detail?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/** Selectable chip (single choice). Selected: sage with a check. */
export function Chip({ label, selected, onPress, dotColor, icon, block, detail, style, accessibilityLabel }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: Boolean(selected) }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.chip,
        block && styles.block,
        selected ? styles.selected : styles.idle,
        pressed && !selected && { backgroundColor: Colors.surfaceSunken },
        style,
      ]}>
      {block ? (
        <MaterialCommunityIcons
          name={selected ? 'radiobox-marked' : 'radiobox-blank'}
          size={20}
          color={selected ? Colors.primary : Colors.textMuted}
        />
      ) : selected ? (
        <MaterialCommunityIcons name="check" size={16} color={Colors.primaryDark} />
      ) : null}
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      {icon ? <MaterialCommunityIcons name={icon} size={16} color={selected ? Colors.primaryDark : Colors.textSecondary} /> : null}
      <View style={block ? styles.blockText : styles.inlineText}>
        <Text
          variant="captionStrong"
          color={selected ? 'primaryDark' : 'text'}
          numberOfLines={1}
          maxFontSizeMultiplier={A11y.controlFontScale}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" color="secondary" numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: A11y.minTouchTarget,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  block: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  idle: { backgroundColor: Colors.surface, borderColor: Colors.borderStrong },
  selected: { backgroundColor: Colors.primarySoft, borderColor: Colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  inlineText: { flexShrink: 1 },
  blockText: { flex: 1, minWidth: 0 },
});
