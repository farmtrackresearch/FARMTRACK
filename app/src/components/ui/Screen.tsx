import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { ReactNode, useContext } from 'react';
import {
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerStack } from '@/components/ui/BannerStack';
import { Colors, Layout, Spacing } from '@/constants/theme';

/**
 * Dark strip behind the status bar plus the app-wide BannerStack. Fixed at
 * the top of every signed-in screen, in the layout flow.
 */
export function TopChrome({ banners = true }: { banners?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.chrome, { paddingTop: insets.top }]}>
      {banners ? <BannerStack /> : null}
    </View>
  );
}

/**
 * Bottom padding for scroll content: clears the tab bar inside the tabs (the
 * bar already pads for the home indicator) or the home indicator elsewhere.
 */
export function useBottomSpace() {
  const insets = useSafeAreaInsets();
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return Layout.scrollBottom + (inTabs ? 0 : insets.bottom);
}

type Props = {
  /** AppHeader. Scrolls with the content in scroll mode, stays put in fixed mode. */
  header?: ReactNode;
  children?: ReactNode;
  /** scroll: one ScrollView for header + content. fixed: children manage their own layout/scrolling. */
  mode?: 'scroll' | 'fixed';
  /** App-wide notices above the header. On for every signed-in screen. */
  banners?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Forms: keeps the focused input above the keyboard. */
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Every screen's frame: cream background, safe areas, banners, consistent
 * horizontal padding and a bottom padding that clears the tab bar.
 */
export function Screen({
  header,
  children,
  mode = 'scroll',
  banners = true,
  refreshing,
  onRefresh,
  keyboard = false,
  contentStyle,
}: Props) {
  const bottom = useBottomSpace();

  const body =
    mode === 'scroll' ? (
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={Colors.textInverse}
              colors={[Colors.primary]}
              progressBackgroundColor={Colors.surface}
            />
          ) : undefined
        }>
        {header}
        <View style={[styles.content, contentStyle]}>{children}</View>
      </ScrollView>
    ) : (
      <View style={styles.fill}>
        {header ? (
          <View style={styles.headerLayer} pointerEvents="box-none">
            {header}
          </View>
        ) : null}
        {children}
      </View>
    );

  return (
    <View style={styles.root}>
      <TopChrome banners={banners} />
      {keyboard ? (
        // padding on both platforms: Android edge-to-edge does not resize the
        // window for the keyboard. The view pads only by the overlap, so a
        // window that did resize gets no extra padding.
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

/** Content padding for FlatList/SectionList screens, matching Screen's scroll mode. */
export const screenContent = StyleSheet.create({
  list: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
  },
}).list;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  chrome: { backgroundColor: Colors.primaryDark, zIndex: 2 },
  fill: { flex: 1 },
  headerLayer: { zIndex: 1 },
  content: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    gap: Layout.sectionGap,
  },
});
