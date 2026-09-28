import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';

type Props = {
  label: string;
  value: string | number;
  icon?: IconName;
  /** Draws attention (hay-gold icon and marker) when something needs a look. */
  attention?: boolean;
  variant?: 'onDark' | 'surface';
};

/** Number + label tile. Used in the header stat rows and inside cards. */
export function StatTile({ label, value, icon, attention = false, variant = 'onDark' }: Props) {
  const dark = variant === 'onDark';
  const iconColor = attention ? Colors.accent : dark ? Colors.textOnDarkMuted : Colors.primary;
  return (
    <View
      style={[styles.tile, dark ? styles.dark : styles.surface]}
      accessible
      accessibilityLabel={`${label}: ${value}${attention ? ', needs attention' : ''}`}>
      <View style={styles.top}>
        {icon ? <MaterialCommunityIcons name={icon} size={16} color={iconColor} /> : null}
        {attention ? <View style={styles.attentionDot} /> : null}
      </View>
      <Text
        variant="stat"
        color={dark ? 'inverse' : 'text'}
        numberOfLines={2}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={A11y.controlFontScale}>
        {value}
      </Text>
      <Text
        variant="caption"
        color={dark ? 'inverseMuted' : 'secondary'}
        numberOfLines={2}
        maxFontSizeMultiplier={A11y.controlFontScale}>
        {label}
      </Text>
    </View>
  );
}

/** Row of equal-width tiles. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  dark: {
    backgroundColor: Colors.onDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.onDarkBorder,
  },
  surface: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 16, marginBottom: 2 },
  attentionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
});
