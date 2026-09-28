import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { CollarCard } from '@/components/livestock/CollarCard';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen, screenContent, useBottomSpace } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { Text } from '@/components/ui/Text';
import { Colors, Layout, Radius, Spacing } from '@/constants/theme';
import { combineTrainingStats, trainingStatsByAnimal } from '@/lib/utils';
import { useFarm } from '@/stores/FarmDataContext';

/**
 * Analytics list — tap an animal for training/detail view. Training success
 * is derived from alert history (warnings that did not escalate to a breach),
 * over the alerts currently loaded: every unresolved one plus the last 100.
 */
export default function AnalyticsScreen() {
  const router = useRouter();
  const { livestock, alerts, now, refresh } = useFarm();
  const bottom = useBottomSpace();
  const [refreshing, setRefreshing] = useState(false);

  const statsByAnimal = useMemo(() => trainingStatsByAnimal(alerts, now), [alerts, now]);
  const herd = useMemo(() => combineTrainingStats(Object.values(statsByAnimal)), [statsByAnimal]);
  const herdLabel = herd.successRate == null ? '—' : `${herd.successRate}%`;
  const audioWarnings = useMemo(
    () => livestock.reduce((sum, l) => sum + (l.audio_warning_count ?? 0), 0),
    [livestock]
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
    <>
      <AppHeader inScroll overline="Herd insights" title="Analytics" subtitle="How well the herd is learning the fences">
        <StatRow>
          <StatTile icon="school-outline" label="Success rate" value={herdLabel} />
          <StatTile icon="alert-outline" label="Fence warnings" value={herd.warnings} />
          <StatTile icon="volume-high" label="Audio warnings" value={audioWarnings} />
        </StatRow>
      </AppHeader>
      <View style={[screenContent, styles.headerContent]}>
        <Card>
          <View style={styles.cardHead}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="chart-line" size={22} color={Colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text variant="heading">Herd training progress</Text>
              <Text variant="caption" color="secondary">
                Warnings that turned animals back, from recent alerts
              </Text>
            </View>
          </View>
          <View style={styles.rateRow}>
            <Text variant="bodyStrong" color="secondary">
              Success rate
            </Text>
            <Text variant="stat" color="primary">
              {herdLabel}
            </Text>
          </View>
          <ProgressBar progress={herd.successRate ?? 0} height={10} accessibilityLabel="Herd success rate" />
          <Text variant="caption" color="secondary" style={styles.rateNote}>
            {herd.warnings === 0
              ? 'No fence warnings in the recent history yet.'
              : `${herd.warnings - herd.escalated} of ${herd.warnings} warnings did not lead to a breach.`}
          </Text>
          <View style={styles.metrics}>
            <StatTile variant="surface" icon="volume-high" label="Audio warnings" value={audioWarnings} />
            <StatTile variant="surface" icon="vibrate-off" label="Vibration motor" value="Not fitted" />
          </View>
        </Card>
        <SectionHeader title="Animals" icon="cow" count={livestock.length} />
      </View>
    </>
  );

  const footer =
    livestock.length > 0 ? (
      <View style={[screenContent, styles.footer]}>
        <SectionHeader
          title="Battery snapshot"
          icon="battery-heart-variant"
          actionLabel="View all"
          onAction={() => router.push('/(tabs)/hardware')}
        />
        {livestock.slice(0, 3).map((animal) => (
          <CollarCard
            key={animal.id}
            animal={animal}
            collar={animal.collar}
            now={now}
            compact
            onPress={() => router.push(`/livestock/${animal.id}`)}
          />
        ))}
      </View>
    ) : null;

  return (
    <Screen mode="fixed">
      <FlatList
        data={livestock}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.textInverse}
            colors={[Colors.primary]}
          />
        }
        ItemSeparatorComponent={Separator}
        renderItem={({ item: animal }) => {
          const rate = statsByAnimal[animal.id]?.successRate ?? null;
          return (
            <View style={styles.rowWrap}>
              <ListRow
                leadingIcon="cow"
                title={animal.name}
                subtitle={`${animal.breed} · ${rate == null ? 'no warnings yet' : `success ${rate}%`}`}
                chevron
                onPress={() => router.push(`/livestock/${animal.id}`)}
                accessibilityLabel={`${animal.name}, ${rate == null ? 'no warnings yet' : `training success ${rate} percent`}`}
                footer={<ProgressBar progress={rate ?? 0} height={6} style={styles.rowBar} />}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={screenContent}>
            <EmptyState
              title="No animals yet"
              message="Training results appear here once animals wear paired collars."
            />
          </View>
        }
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerContent: { gap: Layout.sectionGap, paddingBottom: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  rateNote: { marginTop: Spacing.sm },
  metrics: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  rowWrap: { paddingHorizontal: Layout.screenPadding },
  rowBar: { marginTop: Spacing.sm },
  separator: { height: Spacing.md },
  footer: { gap: Spacing.md, paddingTop: Layout.sectionGap },
});
