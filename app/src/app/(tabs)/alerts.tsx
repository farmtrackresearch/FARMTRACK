import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert as NativeAlert, RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { AlertCard, alertMeta } from '@/components/alerts/AlertCard';
import { AppHeader } from '@/components/ui/AppHeader';
import { CountBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen, screenContent, useBottomSpace } from '@/components/ui/Screen';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { Text } from '@/components/ui/Text';
import { IconName, Tone, ToneColors } from '@/components/ui/tones';
import { Colors, Spacing } from '@/constants/theme';
import { useFarm } from '@/stores/FarmDataContext';
import type { Alert } from '@/types/database';

type AlertSection = { title: string; key: string; data: Alert[]; tone: Tone; icon: IconName };

/**
 * AlertsScreen — chronological activity feed, kept current by the realtime
 * subscriptions in useFarmData. Fence alerts resolve themselves when the
 * server sees the animal back inside; Resolve is for clearing the rest.
 */
export default function AlertsScreen() {
  const router = useRouter();
  const { alerts, alertCounts, resolveAlert, livestock, refresh } = useFarm();
  const bottom = useBottomSpace();
  const [refreshing, setRefreshing] = useState(false);

  const sections = useMemo<AlertSection[]>(() => {
    const unresolved = alerts.filter((a) => a.status === 'unresolved');
    const critical = unresolved.filter((a) => alertMeta(a.alert_type).section === 'critical');
    const warning = unresolved.filter((a) => alertMeta(a.alert_type).section === 'warning');
    const info = unresolved.filter((a) => alertMeta(a.alert_type).section === 'info');
    const resolved = alerts.filter((a) => a.status === 'resolved');

    const all: AlertSection[] = [
      { title: 'Critical', key: 'critical', data: critical, tone: 'critical', icon: 'alert-octagon-outline' },
      { title: 'Warnings', key: 'warning', data: warning, tone: 'warning', icon: 'alert-outline' },
      { title: 'Information', key: 'info', data: info, tone: 'info', icon: 'information-outline' },
      { title: 'Resolved', key: 'resolved', data: resolved, tone: 'neutral', icon: 'check-all' },
    ];
    return all.filter((s) => s.data.length > 0);
  }, [alerts]);

  const openAnimal = useCallback(
    (alert: Alert) => {
      if (alert.livestock_id) router.push(`/livestock/${alert.livestock_id}`);
    },
    [router]
  );

  const confirmResolve = useCallback(
    (alert: Alert) => {
      const animal = livestock.find((l) => l.id === alert.livestock_id);
      const stillOut =
        (alert.alert_type === 'boundary_breach' && animal?.animal_status === 'breach') ||
        (alert.alert_type === 'approach_warning' && animal?.animal_status === 'near_boundary');
      NativeAlert.alert(
        'Resolve this alert?',
        stillOut
          ? `${animal?.name ?? 'The animal'} is still ${alert.alert_type === 'boundary_breach' ? 'outside the fence' : 'near the fence'}. Resolving only removes this alert from the list.`
          : 'It moves to Resolved and stays in the history.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Resolve',
            onPress: () => {
              resolveAlert(alert.id).catch((err: unknown) =>
                NativeAlert.alert('Could not resolve', err instanceof Error ? err.message : 'Unknown error')
              );
            },
          },
        ]
      );
    },
    [livestock, resolveAlert]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const header = (
    <AppHeader inScroll overline="Activity" title="Alerts" subtitle="Newest first. Fence alerts clear themselves.">
      <StatRow>
        <StatTile icon="alert-octagon-outline" label="Critical" value={alertCounts.critical} attention={alertCounts.critical > 0} />
        <StatTile icon="alert-outline" label="Warnings" value={alertCounts.warning} attention={alertCounts.warning > 0} />
        <StatTile icon="information-outline" label="Info" value={alertCounts.info} />
      </StatRow>
    </AppHeader>
  );

  return (
    <Screen mode="fixed">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: bottom }}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.textInverse}
            colors={[Colors.primary]}
          />
        }
        renderSectionHeader={({ section }) => {
          const c = ToneColors[section.tone];
          return (
            <View style={[screenContent, styles.sectionHead]} accessibilityRole="header">
              <MaterialCommunityIcons name={section.icon} size={20} color={c.color} />
              <Text variant="title" style={styles.sectionTitle}>
                {section.title}
              </Text>
              <CountBadge count={section.data.length} tone={section.tone} />
            </View>
          );
        }}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <AlertCard
              alert={item}
              onPress={item.livestock_id ? () => openAnimal(item) : undefined}
              onResolve={() => confirmResolve(item)}
            />
          </View>
        )}
        ListEmptyComponent={
          <View style={screenContent}>
            <EmptyState title="No alerts right now" message="The herd looks calm. New alerts appear here as they happen." />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  sectionTitle: { flex: 1, fontSize: 18, lineHeight: 24 },
  item: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
});
