import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import { HillsEdge } from '@/components/ui/Illustrations';
import { Text } from '@/components/ui/Text';
import { Colors, Spacing, TypographyVariant } from '@/constants/theme';

type Props = {
  /** tab: large title for the five tabs. stack: back button row, then the title. */
  variant?: 'tab' | 'stack';
  title: string;
  overline?: string | null;
  subtitle?: string | null;
  /** Actions on the right (IconButtons with variant="onDark", pills). */
  right?: ReactNode;
  /** Stack screens: shows the back button. */
  onBack?: () => void;
  /** Small row right under the title, e.g. the connection pill. */
  below?: ReactNode;
  /** Stat row or other content under the title. */
  children?: ReactNode;
  /** Smaller padding and hills, for the map. */
  compact?: boolean;
  titleVariant?: TypographyVariant;
  titleLines?: number;
  /** Paints the dark colour above the header so an iOS overscroll never shows a cream gap. */
  inScroll?: boolean;
  /** overlay: the hills edge lets the content underneath (the map) show below the wave. */
  edge?: 'page' | 'overlay';
};

/**
 * The one header pattern: dark meadow band with a rolling-hills edge. Safe
 * area and banners live above it in TopChrome, so every screen's header starts
 * at the same place and has the same title style.
 */
export function AppHeader({
  variant = 'tab',
  title,
  overline,
  subtitle,
  right,
  onBack,
  below,
  children,
  compact = false,
  titleVariant,
  titleLines = 2,
  inScroll = false,
  edge = 'page',
}: Props) {
  const stack = variant === 'stack';
  const heading = titleVariant ?? (stack ? 'title' : compact ? 'title' : 'display');

  const titleBlock = (
    <View style={styles.titleBlock}>
      {overline ? (
        <Text variant="overline" color={Colors.primarySoft} numberOfLines={1}>
          {overline}
        </Text>
      ) : null}
      <Text variant={heading} color="inverse" numberOfLines={titleLines} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="caption" color="inverseMuted" numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
      {below ? <View style={styles.below}>{below}</View> : null}
    </View>
  );

  return (
    <View pointerEvents="box-none">
      {inScroll ? <View style={styles.overscrollCap} /> : null}
      <View style={[styles.inner, compact && styles.innerCompact, children ? styles.withChildren : null]}>
        {stack ? (
          <>
            <View style={styles.navRow}>
              {onBack ? (
                <IconButton icon="chevron-left" iconSize={26} variant="onDark" onPress={onBack} accessibilityLabel="Back" />
              ) : (
                <View />
              )}
              <View style={styles.actions}>{right}</View>
            </View>
            {titleBlock}
          </>
        ) : (
          <View style={styles.tabRow}>
            {titleBlock}
            {right ? <View style={styles.actions}>{right}</View> : null}
          </View>
        )}
        {children ? <View style={styles.children}>{children}</View> : null}
      </View>
      <HillsEdge compact={compact} overlay={edge === 'overlay'} />
    </View>
  );
}

const styles = StyleSheet.create({
  overscrollCap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -800,
    height: 800,
    backgroundColor: Colors.primaryDark,
  },
  inner: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  innerCompact: { paddingTop: Spacing.sm, paddingBottom: 0 },
  withChildren: { paddingBottom: Spacing.md },
  tabRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: -Spacing.sm,
    minHeight: 44,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 0 },
  children: { marginTop: Spacing.sm },
  below: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
});
