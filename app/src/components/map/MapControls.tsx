import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MapAppearance } from '@/components/map/RanchMap.types';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { A11y, Colors, Radius, Shadows, Spacing } from '@/constants/theme';

// Order is the order they appear in the picker — Standard first.
const APPEARANCES: { id: MapAppearance; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'terrain', label: 'Terrain' },
];

const BUTTON = A11y.minTouchTarget;

/** Height of the controls column, so the map overlay can keep room for it. */
export function mapControlsHeight({
  locate,
  appearance,
  pickerOpen,
}: {
  locate: boolean;
  appearance: boolean;
  pickerOpen: boolean;
}) {
  const gap = Spacing.sm;
  let h = BUTTON * 2 + 1; // zoom group
  if (locate) h += gap + BUTTON;
  if (appearance) h += gap + (pickerOpen ? APPEARANCES.length * BUTTON + Spacing.xs * 2 : BUTTON);
  return h;
}

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Shown only while "check my position" has a fix. */
  onLocate?: () => void;
  mapType: MapAppearance;
  onMapTypeChange: (next: MapAppearance) => void;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  /** Hides the appearance button while drawing, to keep the map clear. */
  showAppearance?: boolean;
};

/** The one vertical stack of map controls, top-right of the map. */
export function MapControls({
  onZoomIn,
  onZoomOut,
  onLocate,
  mapType,
  onMapTypeChange,
  pickerOpen,
  onTogglePicker,
  showAppearance = true,
}: Props) {
  return (
    <View style={styles.column} pointerEvents="box-none">
      <View style={styles.group}>
        <IconButton icon="plus" onPress={onZoomIn} accessibilityLabel="Zoom in" shape="rounded" color={Colors.text} />
        <View style={styles.divider} />
        <IconButton icon="minus" onPress={onZoomOut} accessibilityLabel="Zoom out" shape="rounded" color={Colors.text} />
      </View>

      {onLocate ? (
        <IconButton
          icon="crosshairs-gps"
          variant="surface"
          shape="rounded"
          color={Colors.primary}
          onPress={onLocate}
          accessibilityLabel="Center on my location"
        />
      ) : null}

      {showAppearance ? (
        pickerOpen ? (
          <View style={[styles.group, styles.picker]}>
            {APPEARANCES.map(({ id, label }) => {
              const active = id === mapType;
              return (
                <Pressable
                  key={id}
                  style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                  onPress={() => onMapTypeChange(id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${label} map`}>
                  <MaterialCommunityIcons
                    name={active ? 'radiobox-marked' : 'radiobox-blank'}
                    size={18}
                    color={active ? Colors.primary : Colors.textMuted}
                  />
                  <Text
                    variant={active ? 'captionStrong' : 'caption'}
                    color={active ? 'primaryDark' : 'text'}
                    maxFontSizeMultiplier={A11y.controlFontScale}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <IconButton
            icon="layers-outline"
            variant="surface"
            shape="rounded"
            onPress={onTogglePicker}
            accessibilityLabel="Change map appearance"
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'flex-end', gap: Spacing.sm },
  group: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    ...Shadows.raised,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  picker: { paddingVertical: Spacing.xs, minWidth: 148 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: A11y.minTouchTarget,
  },
  pressed: { backgroundColor: Colors.surfaceSunken },
});
