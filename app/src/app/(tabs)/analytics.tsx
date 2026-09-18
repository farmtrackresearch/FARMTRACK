import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CollarCard } from '@/components/livestock/CollarCard';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { SectionEmoji } from '@/constants/navigation';
import { useFarm } from '@/stores/FarmDataContext';

/** Analytics list — tap an animal for training/detail view */
export default function AnalyticsScreen() {
  const router = useRouter();
  const { livestock } = useFarm();

  const avgSuccess =
    livestock.length === 0
      ? 0
      : Math.round(
          livestock.reduce((sum, l) => sum + (l.training_success_rate ?? 0), 0) / livestock.length
        );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{SectionEmoji.analytics} Analytics</Text>
        <Text style={styles.subtitle}>Training effectiveness & herd insights</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={styles.cardHead}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="chart-line" size={20} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.cardTitle}>Herd Training Progress</Text>
              <Text style={styles.cardSub}>Operant conditioning effectiveness</Text>
            </View>
          </View>

          <View style={styles.rateRow}>
            <Text style={styles.rateLabel}>Avg Success Rate</Text>
            <Text style={styles.rateValue}>{avgSuccess}%</Text>
          </View>
          <ProgressBar progress={avgSuccess} height={10} />

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <View style={[styles.metricIcon, { backgroundColor: Colors.warningSoft }]}>
                <MaterialCommunityIcons name="volume-high" size={18} color={Colors.warning} />
              </View>
              <Text style={styles.metricLabel}>Audio Warnings</Text>
              <Text style={styles.metricValue}>
                {livestock.reduce((s, l) => s + l.audio_warning_count, 0)}
              </Text>
            </View>
            <View style={styles.metric}>
              <View style={[styles.metricIcon, { backgroundColor: Colors.criticalSoft }]}>
                <MaterialCommunityIcons name="lightning-bolt" size={18} color={Colors.critical} />
              </View>
              <Text style={styles.metricLabel}>Vibration Pulses</Text>
              <Text style={styles.metricValue}>
                {livestock.reduce((s, l) => s + l.vibration_pulse_count, 0)}
              </Text>
            </View>
          </View>
        </Card>

        <Text style={styles.section}>Animals</Text>
        {livestock.map((animal) => (
          <Pressable key={animal.id} onPress={() => router.push(`/livestock/${animal.id}`)}>
            <View style={styles.animalRow}>
              <View>
                <Text style={styles.animalName}>{animal.name}</Text>
                <Text style={styles.animalMeta}>
                  {animal.breed} · Success {animal.training_success_rate}%
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.textMuted} />
            </View>
            <ProgressBar
              progress={animal.training_success_rate}
              style={{ marginBottom: 16 }}
              height={6}
            />
          </Pressable>
        ))}

        <Text style={[styles.section, { marginTop: 8 }]}>Battery Snapshot</Text>
        {livestock.slice(0, 3).map((animal) => (
          <CollarCard
            key={animal.id}
            animal={animal}
            collar={animal.collar}
            compact
            onPress={() => router.push(`/livestock/${animal.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.surface,
    paddingTop: 56,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  title: { ...Typography.h1, fontSize: 26, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
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
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
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
  section: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  animalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  animalName: { fontWeight: '700', color: Colors.text, fontSize: 15 },
  animalMeta: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
});
