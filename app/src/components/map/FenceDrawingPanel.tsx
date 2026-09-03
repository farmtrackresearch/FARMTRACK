import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Card';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

type Props = {
  fenceName: string;
  pointCount: number;
  saving: boolean;
  selfIntersecting?: boolean;
  onClose: () => void;
  onSave: () => void;
  onUndo?: () => void;
  onClearAll?: () => void;
  canUndo?: boolean;
  isEditing?: boolean;
};

export function FenceDrawingPanel({
  fenceName,
  pointCount,
  saving,
  selfIntersecting,
  onClose,
  onSave,
  onUndo,
  onClearAll,
  canUndo,
  isEditing,
}: Props) {
  const saveLabel = saving
    ? 'Saving…'
    : isEditing
      ? 'Save Changes'
      : 'Save Fence Boundary';
  const canClear = pointCount > 0;

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.topRow} pointerEvents="box-none">
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{fenceName}</Text>
            {isEditing ? <Badge label="EDITING" tone="info" /> : null}
          </View>
          <Text style={styles.status}>
            {pointCount} point{pointCount === 1 ? '' : 's'} placed ·{' '}
            <Text style={styles.hint}>drag vertices to adjust</Text>
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="close" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {selfIntersecting ? (
        <View style={styles.warningBanner}>
          <Ionicons name="warning" size={18} color={Colors.warning} />
          <Text style={styles.warningText}>
            Boundary lines cross over each other — drag the points apart before saving.
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          onPress={onUndo}
          style={[styles.labeledBtn, !canUndo && styles.labeledBtnDisabled]}
          disabled={!canUndo || saving}>
          <Ionicons
            name="arrow-undo"
            size={20}
            color={canUndo && !saving ? Colors.primary : Colors.textMuted}
          />
          <Text style={[styles.labeledBtnText, !canUndo && styles.labeledBtnTextDisabled]}>
            Undo Last Point
          </Text>
        </Pressable>
        <Pressable
          onPress={onClearAll}
          style={[styles.labeledBtn, !canClear && styles.labeledBtnDisabled]}
          disabled={!canClear || saving}>
          <Ionicons
            name="trash-outline"
            size={20}
            color={canClear && !saving ? Colors.critical : Colors.textMuted}
          />
          <Text
            style={[
              styles.labeledBtnText,
              { color: Colors.critical },
              !canClear && styles.labeledBtnTextDisabled,
            ]}>
            Clear & Restart
          </Text>
        </Pressable>
      </View>

      <Button
        label={saveLabel}
        onPress={onSave}
        disabled={saving || pointCount < 3 || selfIntersecting}
        icon={<Ionicons name="save-outline" size={18} color="#fff" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: '#6FCFEE',
    padding: Spacing.lg,
    ...Shadows.card,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  iconBtnDisabled: {
    opacity: 0.4,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  labeledBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceMuted,
  },
  labeledBtnDisabled: {
    opacity: 0.5,
  },
  labeledBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  labeledBtnTextDisabled: {
    color: Colors.textMuted,
  },
  title: { fontSize: 18, fontWeight: '800', color: Colors.text },
  status: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  hint: { color: Colors.primary, fontWeight: '600' },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
