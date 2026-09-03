import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useFarm } from '@/stores/FarmDataContext';

export default function LivestockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { livestock } = useFarm();

  const animal = livestock.find((l) => l.id === id);
  const collar = animal?.collar;

  if (!animal) {
    return (
      <View style={styles.missing}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <Text>Animal not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={[Colors.primaryDark, Colors.headerMid]}
        style={[styles.hero, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.identity}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{animal.name}</Text>
            <Text style={styles.collarId}>
              Collar {collar?.device_hardware_id ?? 'Unpaired'}
            </Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>
              {animal.animal_status.replace('_', ' ')}
            </Text>
          </View>
        </View>

        <View style={styles.quickStats}>
          <QuickStat label="Battery" value={`${collar?.battery_level ?? '—'}%`} />
          <QuickStat label="Signal" value={collar?.signal_strength ?? '—'} />
          <QuickStat label="Training" value={`${animal.training_success_rate}%`} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={styles.cardHead}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="chart-line" size={20} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.cardTitle}>Training Progress</Text>
              <Text style={styles.cardSub}>Operant conditioning effectiveness</Text>
            </View>
          </View>

          <View style={styles.rateRow}>
            <Text style={styles.rateLabel}>Success Rate</Text>
            <Text style={styles.rateValue}>{animal.training_success_rate}%</Text>
          </View>
          <ProgressBar progress={animal.training_success_rate} height={10} />

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <View style={[styles.metricIcon, { backgroundColor: Colors.warningSoft }]}>
                <MaterialCommunityIcons name="volume-high" size={18} color={Colors.warning} />
              </View>
              <Text style={styles.metricLabel}>Audio Warnings</Text>
              <Text style={styles.metricValue}>{animal.audio_warning_count}</Text>
            </View>
            <View style={styles.metric}>
              <View style={[styles.metricIcon, { backgroundColor: Colors.criticalSoft }]}>
                <MaterialCommunityIcons name="lightning-bolt" size={18} color={Colors.critical} />
              </View>
              <Text style={styles.metricLabel}>Vibration Pulses</Text>
              <Text style={styles.metricValue}>{animal.vibration_pulse_count}</Text>
            </View>
          </View>

          <View style={styles.footerNote}>
            <MaterialCommunityIcons name="waveform" size={16} color={Colors.textMuted} />
            <Text style={styles.footerText}>
              Training sequence: Audio warning → Vibration → Electrical correction when boundary is
              breached.
            </Text>
          </View>
        </Card>

        <Card style={{ marginTop: Spacing.lg }}>
          <Text style={styles.cardTitle}>Profile</Text>
          <InfoRow label="Tag ID" value={animal.tag_id} />
          <InfoRow label="Breed" value={animal.breed} />
          <InfoRow label="Age" value={animal.age != null ? `${animal.age} years` : '—'} />
          <InfoRow label="Health" value={animal.health_status} />
          <InfoRow label="Connection" value={collar?.connection_type ?? '—'} />
          <InfoRow label="Firmware" value={collar?.firmware_version ?? '—'} />
        </Card>

        <Text style={styles.historyTitle}>5-Week Training History</Text>
        <Card>
          <Text style={styles.cardSub}>
            Historical charts can be wired to aggregated `location_logs` and alert counts per week.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.qStat}>
      <Text style={styles.qLabel}>{label}</Text>
      <Text style={styles.qValue}>{value}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backText: { color: '#fff', fontWeight: '600' },
  identity: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { color: '#fff', fontSize: 28, fontWeight: '800' },
  collarId: { color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  statusPill: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: { color: '#fff', fontWeight: '600', fontSize: 12, textTransform: 'capitalize' },
  quickStats: { flexDirection: 'row', gap: 10, marginTop: 20 },
  qStat: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  qLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginBottom: 4 },
  qValue: { color: '#fff', fontWeight: '800', fontSize: 18 },
  content: { padding: Spacing.lg, paddingBottom: 40 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontWeight: '700', fontSize: 16, color: Colors.text },
  cardSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  rateLabel: { color: Colors.textSecondary, fontWeight: '600' },
  rateValue: { color: Colors.primary, fontWeight: '800', fontSize: 16 },
  metrics: { flexDirection: 'row', gap: 10, marginTop: 16 },
  metric: {
    flex: 1,
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  metricLabel: { fontSize: 12, color: Colors.textMuted },
  metricValue: { fontSize: 20, fontWeight: '800', color: Colors.text, marginTop: 4 },
  footerNote: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'flex-start' },
  footerText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  historyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  infoLabel: { color: Colors.textMuted },
  infoValue: { color: Colors.text, fontWeight: '600', textTransform: 'capitalize' },
});
