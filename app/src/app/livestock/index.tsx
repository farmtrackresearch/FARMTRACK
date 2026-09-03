import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Card';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useFarm } from '@/stores/FarmDataContext';

/**
 * LivestockScreen — Admin CRUD for animal profiles & collar pairing.
 */
export default function LivestockScreen() {
  const router = useRouter();
  const { livestock, deleteLivestock, isAdmin } = useFarm();

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: 'Livestock',
          headerRight: () =>
            isAdmin ? (
              <Pressable onPress={() => router.push('/livestock/create')} hitSlop={8}>
                <Ionicons name="add" size={26} color="#fff" />
              </Pressable>
            ) : null,
        }}
      />

      {!isAdmin ? (
        <Text style={styles.readOnly}>Staff have read-only access to livestock profiles.</Text>
      ) : null}

      <FlatList
        data={livestock}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          isAdmin ? (
            <Button
              label="Add Animal"
              icon={<Ionicons name="add" size={18} color="#fff" />}
              onPress={() => router.push('/livestock/create')}
              style={{ marginBottom: Spacing.lg }}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/livestock/${item.id}`)}
            onLongPress={() => {
              if (!isAdmin) return;
              Alert.alert('Delete animal?', item.name, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => void deleteLivestock(item.id),
                },
              ]);
            }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                Tag {item.tag_id} · {item.breed}
                {item.age != null ? ` · ${item.age} yrs` : ''}
              </Text>
              <Text style={styles.collar}>
                {item.collar?.device_hardware_id
                  ? `Collar ${item.collar.device_hardware_id}`
                  : 'No collar paired'}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: statusBg(item.health_status) }]}>
              <Text style={[styles.badgeText, { color: statusColor(item.health_status) }]}>
                {item.health_status}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

function statusBg(s: string) {
  if (s === 'critical') return Colors.criticalSoft;
  if (s === 'monitoring') return Colors.warningSoft;
  return Colors.successSoft;
}

function statusColor(s: string) {
  if (s === 'critical') return Colors.critical;
  if (s === 'monitoring') return Colors.warning;
  return Colors.primary;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  readOnly: {
    textAlign: 'center',
    color: Colors.textMuted,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceMuted,
  },
  list: { padding: Spacing.lg, paddingBottom: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    ...Shadows.card,
  },
  name: { fontSize: 16, fontWeight: '700', color: Colors.text },
  meta: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  collar: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    marginLeft: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
});
