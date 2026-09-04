import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';

import { AlertCard, alertMeta } from '@/components/alerts/AlertCard';
import { GlassStat, GradientHeader } from '@/components/ui/GradientHeader';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { SectionEmoji } from '@/constants/navigation';
import { useFarm } from '@/stores/FarmDataContext';
import type { Alert } from '@/types/database';

/**
 * AlertsScreen — chronological activity feed with realtime inserts
 * via Supabase channel (wired in useFarmData).
 */
export default function AlertsScreen() {
  const router = useRouter();
  const { alerts, alertCounts, resolveAlert } = useFarm();

  const sections = useMemo(() => {
    const unresolved = alerts.filter((a) => a.status === 'unresolved');
    const critical = unresolved.filter((a) => alertMeta(a.alert_type).section === 'critical');
    const warning = unresolved.filter((a) => alertMeta(a.alert_type).section === 'warning');
    const info = unresolved.filter((a) => alertMeta(a.alert_type).section === 'info');
    const resolved = alerts.filter((a) => a.status === 'resolved');

    return [
      { title: 'Critical', key: 'critical', data: critical, color: Colors.critical },
      { title: 'Warnings', key: 'warning', data: warning, color: Colors.warning },
      { title: 'Information', key: 'info', data: info, color: Colors.info },
      { title: 'Resolved', key: 'resolved', data: resolved, color: Colors.textMuted },
    ].filter((s) => s.data.length > 0);
  }, [alerts]);

  const onPressAlert = (alert: Alert) => {
    if (alert.livestock_id) {
      router.push(`/livestock/${alert.livestock_id}`);
    }
    if (alert.status === 'unresolved') {
      void resolveAlert(alert.id);
    }
  };

  return (
    <View style={styles.root}>
      <GradientHeader
        title={`${SectionEmoji.alerts} Alerts & Events`}
        subtitle="Chronological activity feed"
        colors={[Colors.primaryDark, Colors.headerEnd]}>
        <View style={styles.stats}>
          <GlassStat label="Critical" value={alertCounts.critical} valueColor="#FF8A80" />
          <GlassStat label="Warning" value={alertCounts.warning} valueColor="#FFCC80" />
          <GlassStat label="Info" value={alertCounts.info} valueColor="#80CBC4" />
        </View>
      </GradientHeader>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHead}>
            <View style={[styles.bar, { backgroundColor: section.color }]} />
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={[styles.countPill, { backgroundColor: section.color }]}>
              <Text style={styles.countText}>{section.data.length}</Text>
            </View>
          </View>
        )}
        renderItem={({ item }) => (
          <AlertCard alert={item} onPress={() => onPressAlert(item)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No alerts right now — herd looks calm.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  stats: { flexDirection: 'row', gap: 10, marginTop: Spacing.xl },
  list: { padding: Spacing.lg, paddingBottom: 40 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  bar: {
    width: 4,
    height: 18,
    borderRadius: 2,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  countPill: {
    minWidth: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  empty: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: 40,
  },
});
