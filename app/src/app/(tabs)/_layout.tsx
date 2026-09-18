import { Tabs, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AlarmOverlay } from '@/components/alerts/AlarmOverlay';
import { LiveAlertBanner } from '@/components/map/LiveAlertBanner';
import { Colors, Radius, Typography } from '@/constants/theme';
import { SectionEmoji } from '@/constants/navigation';
import { useFarm } from '@/stores/FarmDataContext';

function TabIcon({ emoji, focused, badge }: { emoji: string; focused: boolean; badge?: number }) {
  return (
    <View style={styles.iconWrap}>
      <View style={[styles.pill, focused && styles.pillActive]}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  const { alertCounts, liveAlert, dismissLiveAlert } = useFarm();
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      <AlarmOverlay />
      {liveAlert ? (
        <LiveAlertBanner
          alert={liveAlert}
          onDismiss={dismissLiveAlert}
          onNavigate={() => {
            dismissLiveAlert();
            router.push('/(tabs)/map');
          }}
        />
      ) : null}
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.tabInactive,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ focused }) => <TabIcon emoji={SectionEmoji.dashboard} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ focused }) => <TabIcon emoji={SectionEmoji.map} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: 'Analytics',
            tabBarIcon: ({ focused }) => <TabIcon emoji={SectionEmoji.analytics} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="hardware"
          options={{
            title: 'Hardware',
            tabBarIcon: ({ focused }) => <TabIcon emoji={SectionEmoji.hardware} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="alerts"
          options={{
            title: 'Alerts',
            tabBarIcon: ({ focused }) => (
              <TabIcon
                emoji={SectionEmoji.alerts}
                focused={focused}
                badge={alertCounts.critical || alertCounts.total}
              />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 92,
    paddingTop: 10,
    paddingBottom: 28,
  },
  tabLabel: {
    ...Typography.caption,
    fontSize: 11,
    fontFamily: Typography.label.fontFamily,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    width: 44,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: Colors.successSoft,
  },
  emoji: {
    fontSize: 20,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 0,
    backgroundColor: Colors.badge,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
