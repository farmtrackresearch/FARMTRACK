import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Card';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  fenceName: string;
  areaHectares: number;
  pointCount: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SaveBoundaryModal({
  visible,
  fenceName,
  areaHectares,
  pointCount,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={saving ? undefined : onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconBox}>
            <MaterialCommunityIcons name="check-decagram-outline" size={28} color={Colors.primary} />
          </View>

          <Text style={styles.title}>Save this boundary?</Text>
          <Text style={styles.name}>{fenceName}</Text>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{areaHectares.toFixed(2)}</Text>
              <Text style={styles.statLabel}>hectares</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{pointCount}</Text>
              <Text style={styles.statLabel}>points</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Button
              label="Back"
              variant="outline"
              onPress={onCancel}
              disabled={saving}
              style={styles.actionBtn}
            />
            <Button
              label={saving ? 'Saving…' : 'Save Boundary'}
              onPress={onConfirm}
              disabled={saving}
              style={styles.actionBtn}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: Spacing.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    ...Shadows.card,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  name: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    width: '100%',
    marginBottom: Spacing.xl,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.border },
  statValue: { fontSize: 22, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  actionBtn: { flex: 1 },
});
