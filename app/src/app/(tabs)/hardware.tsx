import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { CollarCard } from '@/components/livestock/CollarCard';
import { AppHeader } from '@/components/ui/AppHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { Screen, screenContent, useBottomSpace } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { Colors, Layout, Spacing } from '@/constants/theme';
import { batteryLabel, isStale, LOW_BATTERY_PERCENT, timeAgo } from '@/lib/utils';
import { useFarm } from '@/stores/FarmDataContext';
import type { Collar, Livestock } from '@/types/database';

const PAIRING_STEPS =
  '1. Switch the collar on near the gateway.\n' +
  '2. Within a minute it appears below as an unassigned collar, named by its ID ' +
  '(FT-XXXXXXXX, also printed on the collar serial console at start-up).\n' +
  '3. Tap Pair next to it, then choose an existing animal or add a new one.\n\n' +
  'The collar only raises fence alerts once it is paired with an animal.';

type Row = { kind: 'unassigned'; collar: Collar } | { kind: 'paired'; animal: Livestock };
type HardwareSection = { key: string; title: string; icon: 'link-variant-off' | 'link-variant'; data: Row[] };

export default function HardwareScreen() {
  const router = useRouter();
  const { livestock, collars, isAdmin, now, refresh } = useFarm();
  const bottom = useBottomSpace();
  const [refreshing, setRefreshing] = useState(false);

  const lowBattery = collars.filter((c) => c.battery_level != null && c.battery_level < LOW_BATTERY_PERCENT).length;
  const offline = collars.filter((c) => isStale(c.last_ping_at, now)).length;

  const sections = useMemo<HardwareSection[]>(() => {
    const unassigned = collars.filter((c) => !livestock.some((l) => l.collar_id === c.id));
    const out: HardwareSection[] = [];
    if (unassigned.length > 0) {
      out.push({
        key: 'unassigned',
        title: 'Unassigned collars',
        icon: 'link-variant-off',
        data: unassigned.map((collar) => ({ kind: 'unassigned', collar })),
      });
    }
    if (livestock.length > 0) {
      out.push({
        key: 'paired',
        title: 'Paired collars',
        icon: 'link-variant',
        data: livestock.map((animal) => ({ kind: 'paired', animal })),
      });
    }
    return out;
  }, [collars, livestock]);

  const pair = (collarId: string) => router.push({ pathname: '/livestock/create', params: { collarId } });

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
      <AppHeader inScroll overline="Collars & gateway" title="Hardware" subtitle="Battery, signal and pairing">
        <StatRow>
          <StatTile icon="access-point" label="Total collars" value={collars.length} />
          <StatTile icon="battery-alert-variant-outline" label="Low battery" value={lowBattery} attention={lowBattery > 0} />
          <StatTile icon="wifi-off" label="Offline" value={offline} attention={offline > 0} />
        </StatRow>
      </AppHeader>
      <View style={[screenContent, styles.headerContent]}>
        <Button
          label="How to pair a collar"
          variant="secondary"
          icon="link-variant"
          onPress={() =>
            Alert.alert('Pair a collar', isAdmin ? PAIRING_STEPS : `${PAIRING_STEPS}\n\nOnly admins can pair collars.`)
          }
        />
      </View>
    </>
  );

  return (
    <Screen mode="fixed">
      <SectionList
        sections={sections}
        keyExtractor={(row) => (row.kind === 'paired' ? `a-${row.animal.id}` : `c-${row.collar.id}`)}
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
        renderSectionHeader={({ section }) => (
          <View style={[screenContent, styles.sectionHead]}>
            <SectionHeader title={section.title} icon={section.icon} count={section.data.length} />
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.item}>
            {item.kind === 'unassigned' ? (
              <ListRow
                leadingIcon="access-point"
                leadingTone={isStale(item.collar.last_ping_at, now) ? 'offline' : 'info'}
                title={item.collar.device_hardware_id}
                subtitle={`Battery ${batteryLabel(item.collar.battery_level)} · heard ${timeAgo(item.collar.last_ping_at, now).toLowerCase()}`}
                footer={
                  <Badge
                    label={isStale(item.collar.last_ping_at, now) ? 'Offline' : 'Online'}
                    tone={isStale(item.collar.last_ping_at, now) ? 'offline' : 'success'}
                    dot
                    style={styles.badge}
                  />
                }
                trailing={
                  isAdmin ? (
                    <Button
                      label="Pair"
                      icon="link-variant"
                      size="sm"
                      onPress={() => pair(item.collar.id)}
                      accessibilityLabel={`Pair collar ${item.collar.device_hardware_id}`}
                    />
                  ) : null
                }
              />
            ) : (
              <CollarCard
                animal={item.animal}
                collar={item.animal.collar ?? collars.find((c) => c.id === item.animal.collar_id)}
                now={now}
                onPress={() => router.push(`/livestock/${item.animal.id}`)}
              />
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={screenContent}>
            <EmptyState
              title="No collars yet"
              message="Switch one on near the gateway and it will appear here within a minute."
            />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerContent: { paddingBottom: Spacing.sm },
  sectionHead: { paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  item: { paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing.md },
  badge: { marginTop: Spacing.xs },
});
