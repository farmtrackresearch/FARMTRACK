import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { MapSheet } from '@/components/map/MapSheet';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { Colors, Spacing } from '@/constants/theme';

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

/** Drawing controls as the map's bottom sheet. Compact so the map stays visible on small phones. */
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
  const saveLabel = saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save fence';
  const canClear = pointCount > 0;

  return (
    <MapSheet>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}>
        <View style={styles.topRow}>
          <MaterialCommunityIcons name="vector-polygon" size={22} color={Colors.info} />
          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <Text variant="heading" numberOfLines={1} style={styles.title}>
                {fenceName}
              </Text>
              <Badge label={isEditing ? 'Editing' : 'Drawing'} tone="info" />
            </View>
            <Text variant="caption" color="secondary" numberOfLines={2}>
              {pointCount} point{pointCount === 1 ? '' : 's'} · tap the map to add · drag a point to move it, tap it to
              remove it
            </Text>
          </View>
          <IconButton icon="close" onPress={onClose} accessibilityLabel="Stop drawing" disabled={saving} />
        </View>

        {selfIntersecting ? (
          <Banner
            tone="warning"
            compact
            title="Boundary lines cross over each other"
            message="Drag the points apart before saving."
          />
        ) : null}

        <View style={styles.actions}>
          <IconButton
            icon="undo-variant"
            variant="outlined"
            shape="rounded"
            size={48}
            onPress={onUndo}
            disabled={!canUndo || saving}
            accessibilityLabel="Undo last point"
          />
          <IconButton
            icon="delete-outline"
            variant="dangerOutlined"
            shape="rounded"
            size={48}
            onPress={onClearAll}
            disabled={!canClear || saving}
            accessibilityLabel="Clear and restart"
          />
          <Button
            label={saveLabel}
            icon="content-save-outline"
            onPress={onSave}
            loading={saving}
            disabled={pointCount < 3 || selfIntersecting}
            style={styles.save}
          />
        </View>
      </ScrollView>
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  scroll: { flexShrink: 1 },
  body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: Spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  save: { flex: 1 },
});
