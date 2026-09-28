import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { SectionIcons, SectionKey } from '@/constants/navigation';
import { A11y, Colors, FontFamily, Layout, Radius, Spacing } from '@/constants/theme';
import { useFarm } from '@/stores/FarmDataContext';

const tint = (focused: boolean) => (focused ? Colors.primaryDark : Colors.textSecondary);

function TabIcon({
  section,
  focused,
  badge,
  badgeCritical,
}: {
  section: SectionKey;
  focused: boolean;
  badge?: number;
  badgeCritical?: boolean;
}) {
  const [idle, active] = SectionIcons[section];
  const color = tint(focused);
  return (
    <View style={[styles.pill, focused && styles.pillActive]}>
      <MaterialCommunityIcons name={focused ? active : idle} size={22} color={color} />
      {badge && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: badgeCritical ? Colors.critical : Colors.warningInk }]}>
          <Text variant="overline" color="inverse" style={styles.badgeText} maxFontSizeMultiplier={1}>
            {badge > 9 ? '9+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TabLabel({ children, focused }: { children: string; focused: boolean }) {
  return (
    <Text
      variant="overline"
      color={tint(focused)}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.85}
      maxFontSizeMultiplier={A11y.controlFontScale}
      style={styles.label}>
      {children}
    </Text>
  );
}

export default function TabsLayout() {
  const { alertCounts } = useFarm();
  const insets = useSafeAreaInsets();
  const alertBadge = alertCounts.critical || alertCounts.total;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primaryDark,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: [
          styles.tabBar,
          { height: Layout.tabBarHeight + insets.bottom, paddingBottom: insets.bottom + Spacing.xs },
        ],
        tabBarItemStyle: styles.item,
        tabBarLabel: ({ children, focused }) => <TabLabel focused={focused}>{children}</TabLabel>,
        sceneStyle: { backgroundColor: Colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => <TabIcon section="dashboard" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => <TabIcon section="map" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ focused }) => <TabIcon section="analytics" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="hardware"
        options={{
          title: 'Hardware',
          tabBarIcon: ({ focused }) => <TabIcon section="hardware" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarAccessibilityLabel: alertBadge > 0 ? `Alerts, ${alertBadge} unresolved` : 'Alerts',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              section="alerts"
              focused={focused}
              badge={alertBadge}
              badgeCritical={alertCounts.critical > 0}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    elevation: 0,
  },
  item: { gap: 2, paddingHorizontal: 0 },
  pill: {
    width: 52,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: Colors.primarySoft },
  label: { fontFamily: FontFamily.medium, letterSpacing: 0, textTransform: 'none', fontSize: 11 },
  badge: {
    position: 'absolute',
    top: -4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12, letterSpacing: 0 },
});
