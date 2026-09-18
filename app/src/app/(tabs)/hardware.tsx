import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CollarCard } from '@/components/livestock/CollarCard';
import { Button } from '@/components/ui/Card';
import { GlassStat, GradientHeader } from '@/components/ui/GradientHeader';
import { Colors, Spacing } from '@/constants/theme';
import { SectionEmoji } from '@/constants/navigation';
import { useFarm } from '@/stores/FarmDataContext';

export default function HardwareScreen() {
  const router = useRouter();
  const { livestock, collars, isAdmin } = useFarm();

  const lowBattery = collars.filter((c) => c.battery_level < 50).length;
  const offline = collars.filter((c) => c.status === 'offline').length;

  return (
    <View style={styles.root}>
      <GradientHeader
        title={`${SectionEmoji.hardware} Hardware Hub`}
        subtitle="Collar management & connectivity">
        <View style={styles.stats}>
          <GlassStat label="Total Collars" value={collars.length} />
          <GlassStat label="Low Battery" value={lowBattery} valueColor={Colors.warning} />
          <GlassStat label="Offline" value={offline} valueColor={offline ? Colors.critical : '#fff'} />
        </View>
      </GradientHeader>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Button
          label="Pair New Device"
          icon={<MaterialCommunityIcons name="qrcode-scan" size={18} color="#fff" />}
          disabled={!isAdmin}
          onPress={() =>
            Alert.alert(
              'Pair Device',
              isAdmin
                ? 'Scan the ESP32 collar QR code, then assign it on the Livestock screen.'
                : 'Only admins can pair devices.'
            )
          }
          style={{ marginBottom: Spacing.lg }}
        />

        {livestock.length === 0 && collars.length === 0 ? (
          <Text style={styles.emptyHint}>
            No devices paired yet. Tap Pair New Device to register your first collar.
          </Text>
        ) : null}

        {livestock.map((animal) => (
          <CollarCard
            key={animal.id}
            animal={animal}
            collar={animal.collar ?? collars.find((c) => c.id === animal.collar_id)}
            onPress={() => router.push(`/livestock/${animal.id}`)}
          />
        ))}

        {collars
          .filter((c) => !livestock.some((l) => l.collar_id === c.id))
          .map((collar) => (
            <View key={collar.id} style={styles.orphan}>
              <Text style={styles.orphanTitle}>{collar.device_hardware_id}</Text>
              <Text style={styles.orphanSub}>
                Unassigned · {collar.battery_level}% · {collar.status}
              </Text>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  stats: { flexDirection: 'row', gap: 10, marginTop: Spacing.xl },
  content: { padding: Spacing.lg, paddingBottom: 40 },
  orphan: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orphanTitle: { fontWeight: '700', color: Colors.text },
  orphanSub: { color: Colors.textMuted, marginTop: 4, fontSize: 13 },
  emptyHint: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
});
