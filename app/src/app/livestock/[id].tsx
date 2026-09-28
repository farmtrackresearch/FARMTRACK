import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AlertCard } from '@/components/alerts/AlertCard';
import { AppHeader } from '@/components/ui/AppHeader';
import { StatusPill } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { KeyValueRow } from '@/components/ui/ListRow';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { Text } from '@/components/ui/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { batteryLabel, batteryTone, isStale, timeAgo, trainingStatsByAnimal } from '@/lib/utils';
import { useFarm } from '@/stores/FarmDataContext';

export default function LivestockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { livestock, locations, alerts, isAdmin, now } = useFarm();

  const animal = livestock.find((l) => l.id === id);
  const collar = animal?.collar;
  const location = locations.find((l) => l.livestock_id === id);
  const animalAlerts = useMemo(() => alerts.filter((a) => a.livestock_id === id), [alerts, id]);
  const training = useMemo(
    () => trainingStatsByAnimal(animalAlerts, now)[id ?? ''] ?? { warnings: 0, escalated: 0, successRate: null },
    [animalAlerts, id, now]
  );

  if (!animal) {
    return (
      <Screen header={<AppHeader variant="stack" inScroll onBack={() => router.back()} title="Not found" />}>
        <EmptyState title="Animal not found." message="It may have been deleted on another phone." />
      </Screen>
    );
  }

  const stale = isStale(location?.last_seen_at, now);
  const successLabel = training.successRate == null ? '—' : `${training.successRate}%`;
  const lowBattery = batteryTone(collar?.battery_level) === 'critical';

  return (
    <Screen
      header={
        <AppHeader
          variant="stack"
          inScroll
          onBack={() => router.back()}
          overline={`Tag ${animal.tag_id}`}
          title={animal.name}
          titleVariant="display"
          subtitle={`Collar ${collar?.device_hardware_id ?? 'not paired'}`}
          right={
            isAdmin ? (
              <IconButton
                icon="pencil-outline"
                variant="onDark"
                onPress={() => router.push({ pathname: '/livestock/create', params: { id: animal.id } })}
                accessibilityLabel={`Edit ${animal.name}`}
              />
            ) : null
          }>
          <View style={styles.pillRow}>
            <StatusPill status={animal.animal_status} stale={stale} />
          </View>
          <StatRow>
            <StatTile
              icon={lowBattery ? 'battery-alert-variant-outline' : 'battery-medium'}
              label="Battery"
              value={batteryLabel(collar?.battery_level)}
              attention={lowBattery}
            />
            <StatTile
              icon={stale ? 'clock-alert-outline' : 'crosshairs-gps'}
              label={stale ? 'Last fix (stale)' : 'Last fix'}
              value={location?.last_seen_at ? timeAgo(location.last_seen_at, now) : '—'}
              attention={stale}
            />
            <StatTile icon="school-outline" label="Training" value={successLabel} />
          </StatRow>
        </AppHeader>
      }>
      <Card>
        <View style={styles.cardHead}>
          <View style={styles.iconBox}>
            <MaterialCommunityIcons name="chart-line" size={22} color={Colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text variant="heading">Training progress</Text>
            <Text variant="caption" color="secondary">
              Warnings that turned the animal back, from recent alerts
            </Text>
          </View>
        </View>
        <View style={styles.rateRow}>
          <Text variant="bodyStrong" color="secondary">
            Success rate
          </Text>
          <Text variant="stat" color="primary">
            {successLabel}
          </Text>
        </View>
        <ProgressBar progress={training.successRate ?? 0} height={10} accessibilityLabel="Training success rate" />
        <Text variant="caption" color="secondary" style={styles.note}>
          {training.warnings === 0
            ? 'No fence warnings yet.'
            : `${training.warnings - training.escalated} of ${training.warnings} warnings did not lead to a breach.`}
        </Text>
        <View style={styles.metrics}>
          <StatTile variant="surface" icon="volume-high" label="Audio warnings" value={animal.audio_warning_count ?? 0} />
          <StatTile variant="surface" icon="vibrate-off" label="Vibration motor" value="Not fitted" />
        </View>
        <View style={styles.footerNote}>
          <MaterialCommunityIcons name="waveform" size={16} color={Colors.textSecondary} />
          <Text variant="caption" color="secondary" style={styles.flex}>
            The collar beeps when the animal nears the fence and beeps urgently once it is outside. There is no
            vibration or electric correction.
          </Text>
        </View>
      </Card>

      <Card>
        <Text variant="heading" style={styles.profileTitle}>
          Profile
        </Text>
        <KeyValueRow label="Tag ID" value={animal.tag_id} />
        <KeyValueRow label="Breed" value={animal.breed} />
        <KeyValueRow label="Age" value={animal.age != null ? `${animal.age} years` : '—'} />
        <KeyValueRow label="Health" value={capitalize(animal.health_status)} />
        <KeyValueRow label="Connection" value={collar?.connection_type ?? '—'} />
        <KeyValueRow label="Firmware" value={collar?.firmware_version ?? '—'} />
        <KeyValueRow label="GPS satellites" value={location?.sats != null ? String(location.sats) : '—'} last />
      </Card>

      <View style={styles.section}>
        <SectionHeader title="Recent alerts" icon="bell-outline" count={animalAlerts.length} />
        {animalAlerts.length === 0 ? (
          <EmptyState scene={false} icon="bell-check-outline" title="No alerts for this animal in the recent history." />
        ) : (
          animalAlerts.slice(0, 5).map((a) => <AlertCard key={a.id} alert={a} />)
        )}
      </View>
    </Screen>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pillRow: { flexDirection: 'row', marginBottom: Spacing.md },
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
  note: { marginTop: Spacing.sm },
  metrics: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  footerNote: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, alignItems: 'flex-start' },
  profileTitle: { marginBottom: Spacing.xs },
  section: { gap: Spacing.md },
});
