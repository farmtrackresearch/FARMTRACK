import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/ui/AppHeader';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { Screen, screenContent, useBottomSpace } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import type { Tone } from '@/components/ui/tones';
import { Layout, Spacing } from '@/constants/theme';
import { useFarm } from '@/stores/FarmDataContext';
import type { HealthStatus, Livestock } from '@/types/database';

const HEALTH_TONE: Record<HealthStatus, Tone> = {
  healthy: 'success',
  monitoring: 'warning',
  critical: 'critical',
};

/**
 * LivestockScreen — Admin CRUD for animal profiles & collar pairing.
 */
export default function LivestockScreen() {
  const router = useRouter();
  const { livestock, deleteLivestock, isAdmin } = useFarm();
  const bottom = useBottomSpace();

  const confirmDelete = useCallback(
    (item: Livestock) => {
      if (!isAdmin) return;
      Alert.alert('Delete animal?', `${item.name} will be removed. Its collar becomes unassigned.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteLivestock(item.id).catch((err: unknown) =>
              Alert.alert('Could not delete', err instanceof Error ? err.message : 'Unknown error')
            );
          },
        },
      ]);
    },
    [deleteLivestock, isAdmin]
  );

  const header = (
    <>
      <AppHeader
        variant="stack"
        inScroll
        onBack={() => router.back()}
        overline="Herd"
        title="Livestock"
        subtitle={`${livestock.length} animal${livestock.length === 1 ? '' : 's'}`}
      />
      <View style={[screenContent, styles.headerContent]}>
        {isAdmin ? (
          <>
            <Button label="Add animal" icon="plus" onPress={() => router.push('/livestock/create')} />
            {livestock.length > 0 ? (
              <Text variant="caption" color="secondary">
                Tap an animal for details. Press and hold to delete it.
              </Text>
            ) : null}
          </>
        ) : (
          <Banner tone="info" icon="lock-outline" title="Staff have read-only access to livestock profiles." />
        )}
      </View>
    </>
  );

  return (
    <Screen mode="fixed">
      <FlatList
        data={livestock}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => (
          <View style={styles.rowWrap}>
            <ListRow
              leadingIcon="cow"
              leadingTone={HEALTH_TONE[item.health_status]}
              title={item.name}
              subtitle={`Tag ${item.tag_id} · ${item.breed}${item.age != null ? ` · ${item.age} yrs` : ''}`}
              meta={item.collar?.device_hardware_id ? `Collar ${item.collar.device_hardware_id}` : 'No collar paired'}
              footer={<Badge label={item.health_status} tone={HEALTH_TONE[item.health_status]} dot style={styles.badge} />}
              chevron
              onPress={() => router.push(`/livestock/${item.id}`)}
              onLongPress={isAdmin ? () => confirmDelete(item) : undefined}
              accessibilityLabel={`${item.name}, tag ${item.tag_id}, ${item.health_status}`}
              accessibilityHint={isAdmin ? 'Press and hold to delete' : undefined}
            />
          </View>
        )}
        ListEmptyComponent={
          <View style={screenContent}>
            <EmptyState
              title="No animals yet"
              message={isAdmin ? 'Add your first one, then pair a collar to start tracking.' : 'An admin can add animals.'}
              actionLabel={isAdmin ? 'Add your first animal' : undefined}
              actionIcon="plus"
              onAction={isAdmin ? () => router.push('/livestock/create') : undefined}
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
  headerContent: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  rowWrap: { paddingHorizontal: Layout.screenPadding },
  separator: { height: Spacing.md },
  badge: { marginTop: Spacing.xs },
});
