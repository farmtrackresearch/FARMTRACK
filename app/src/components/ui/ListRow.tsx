import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { IconName, Tone, ToneColors } from '@/components/ui/tones';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string | null;
  /** Third line, smaller. */
  meta?: string | null;
  leadingIcon?: IconName;
  leadingTone?: Tone;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  titleLines?: number;
  subtitleLines?: number;
  /** Extra content under the text, e.g. a progress bar. */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/** One tappable row: icon box, title/subtitle (truncated), trailing content. */
export const ListRow = memo(function ListRow({
  title,
  subtitle,
  meta,
  leadingIcon,
  leadingTone = 'success',
  leading,
  trailing,
  chevron,
  onPress,
  onLongPress,
  titleLines = 1,
  subtitleLines = 2,
  footer,
  style,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const tone = ToneColors[leadingTone];
  const body = (
    <>
      {leading ??
        (leadingIcon ? (
          <View style={[styles.iconBox, { backgroundColor: tone.soft }]}>
            <MaterialCommunityIcons name={leadingIcon} size={22} color={tone.color} />
          </View>
        ) : null)}
      <View style={styles.text}>
        <Text variant="heading" numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="secondary" numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" color="secondary" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {footer}
      </View>
      {trailing}
      {chevron ? <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.textMuted} /> : null}
    </>
  );

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}>
        {body}
      </Pressable>
    );
  }
  return (
    <View style={[styles.row, style]} accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
});

/** Label/value line for details cards. */
export function KeyValueRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.kv, !last && styles.kvBorder]}>
      <Text variant="body" color="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong" style={styles.kvValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 64,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  pressed: { backgroundColor: Colors.surfaceAlt },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.lg,
    minHeight: 44,
    paddingVertical: Spacing.sm,
  },
  kvBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  kvValue: { flexShrink: 1, textAlign: 'right' },
});
