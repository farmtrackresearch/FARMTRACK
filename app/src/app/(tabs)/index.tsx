import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card } from '@/components/ui/Card';
import { GlassStat, GradientHeader } from '@/components/ui/GradientHeader';
import { CollarCard } from '@/components/livestock/CollarCard';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { SectionEmoji } from '@/constants/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useFarm } from '@/stores/FarmDataContext';

export default function DashboardScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const { livestock, geofences, unresolvedAlerts, isAdmin } = useFarm();

  const breach = unresolvedAlerts.filter((a) => a.alert_type === 'boundary_breach').length;
  const lowBattery = unresolvedAlerts.filter((a) => a.alert_type === 'low_battery').length;
  const near = unresolvedAlerts.filter((a) => a.alert_type === 'approach_warning').length;

  return (
    <View style={styles.root}>
      <GradientHeader
        title={`${SectionEmoji.dashboard} FarmTrack`}
        subtitle={profile?.farm_name ?? 'Dumaguete Ranch Operations'}
        right={
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <View style={styles.online}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>Online</Text>
            </View>
            <Pressable onPress={() => void signOut()} hitSlop={8}>
              <Text style={styles.signOut}>
                {profile?.role === 'admin' ? 'Admin' : 'Staff'} · Sign out
              </Text>
            </Pressable>
          </View>
        }>
        <View style={styles.stats}>
          <GlassStat label="Total Head" value={livestock.length} />
          <GlassStat label="Active Fences" value={geofences.filter((g) => g.is_active).length} />
          <GlassStat label="System Status" value="Active" valueColor="#81C784" />
        </View>
      </GradientHeader>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>Quick Actions</Text>
        <View style={styles.actions}>
          <Button
            label="Create New Fence"
            style={{ flex: 1 }}
            icon={<Ionicons name="add" size={18} color="#fff" />}
            onPress={() => router.push('/(tabs)/map?createFence=1')}
            disabled={!isAdmin}
          />
          <Button
            label="Emergency Disable"
            variant="dangerOutline"
            style={{ flex: 1 }}
            icon={<Ionicons name="power" size={16} color={Colors.critical} />}
            onPress={() => router.push('/(tabs)/alerts')}
          />
        </View>

        <Card accentColor={Colors.critical} style={{ marginTop: Spacing.lg }}>
          <View style={styles.attnRow}>
            <MaterialCommunityIcons name="alert-circle" size={20} color={Colors.critical} />
            <Text style={styles.attnTitle}>Immediate Attention Required</Text>
          </View>

          <AlertSummaryRow
            icon="alert"
            color={Colors.critical}
            soft={Colors.criticalSoft}
            title="Boundary Breach"
            subtitle={`${breach} animal outside fence`}
            count={breach}
            onPress={() => router.push('/(tabs)/alerts')}
          />
          <AlertSummaryRow
            icon="battery-alert"
            color={Colors.warning}
            soft={Colors.warningSoft}
            title="Low Battery"
            subtitle="Collar need charging"
            count={lowBattery}
            onPress={() => router.push('/(tabs)/hardware')}
          />
          <AlertSummaryRow
            icon="alert-outline"
            color={Colors.caution}
            soft={Colors.warningSoft}
            title="Near Boundary"
            subtitle={`${near} animal${near === 1 ? '' : 's'} approaching fence`}
            count={near}
            onPress={() => router.push('/(tabs)/map')}
          />
        </Card>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>Collar Battery Health</Text>
          <Text style={styles.link} onPress={() => router.push('/(tabs)/hardware')}>
            View All
          </Text>
        </View>

        {livestock.length === 0 ? (
          <Text style={styles.emptyHint}>
            No collars paired yet. Pair a device from the Hardware tab.
          </Text>
        ) : (
          livestock.slice(0, 4).map((animal) => (
            <CollarCard
              key={animal.id}
              animal={animal}
              collar={animal.collar}
              compact
              onPress={() => router.push(`/livestock/${animal.id}`)}
            />
          ))
        )}

        {isAdmin ? (
          <Button
            label="Manage Livestock"
            variant="ghost"
            onPress={() => router.push('/livestock')}
            style={{ marginBottom: 24 }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function AlertSummaryRow({
  icon,
  color,
  soft,
  title,
  subtitle,
  count,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  soft: string;
  title: string;
  subtitle: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.alertRow, { backgroundColor: soft }]}>
      <View style={[styles.alertIcon, { backgroundColor: color }]}>
        <MaterialCommunityIcons name={icon} size={16} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.alertTitle}>{title}</Text>
        <Text style={styles.alertSub}>{subtitle}</Text>
      </View>
      <Text style={[styles.alertCount, { color }]}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  online: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.online,
  },
  onlineText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  signOut: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 10, marginTop: Spacing.xl },
  content: { padding: Spacing.lg, paddingBottom: 40 },
  section: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  link: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  attnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.md },
  attnTitle: { fontSize: 15, fontWeight: '700', color: Colors.critical },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  alertIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  alertTitle: { fontWeight: '700', color: Colors.text, fontSize: 14 },
  alertSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  alertCount: { fontSize: 22, fontWeight: '800', marginLeft: 8 },
  emptyHint: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
});
