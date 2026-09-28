import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MapSheet } from '@/components/map/MapSheet';
import { CountBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { A11y, Colors, MapPalette, Radius, Shadows, Spacing } from '@/constants/theme';

type UndoToastProps = {
  fenceName: string;
  onUndo: () => void;
  onDismiss?: () => void;
  timeoutMs?: number;
};

/** "Fence saved · Undo" card. Laid out above the fence sheet, never over it. */
export function UndoFenceToast({ fenceName, onUndo, onDismiss, timeoutMs = 8000 }: UndoToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [visible, onDismiss, timeoutMs]);

  if (!visible) return null;

  return (
    <View style={styles.toast} accessibilityLiveRegion="polite">
      <View style={styles.toastIcon}>
        <MaterialCommunityIcons name="check-circle-outline" size={20} color={Colors.primary} />
      </View>
      <View style={styles.flex}>
        <Text variant="overline" color="secondary">
          Fence saved
        </Text>
        <Text variant="bodyStrong" numberOfLines={1}>
          {fenceName}
        </Text>
      </View>
      <Button
        label="Undo"
        icon="undo-variant"
        variant="destructive"
        size="sm"
        accessibilityLabel={`Undo: delete ${fenceName}`}
        onPress={() => {
          setVisible(false);
          onDismiss?.();
          onUndo();
        }}
      />
    </View>
  );
}

type FenceListItem = {
  id: string;
  name: string;
  pointCount: number;
  isActive: boolean;
  bufferMeters?: number;
  created_at?: string | null;
};

type FenceListPanelProps = {
  items: FenceListItem[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onFocus: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  /** Opens the create sheet (it explains read-only access to staff). */
  onCreate: () => void;
  isAdmin: boolean;
};

/** Fence list as the map's bottom sheet, with the "New fence" action. */
export function FenceListPanel({
  items,
  collapsed = false,
  onToggleCollapsed,
  onFocus,
  onDelete,
  onCreate,
  isAdmin,
}: FenceListPanelProps) {
  const empty = items.length === 0;
  const activeCount = items.filter((i) => i.isActive).length;

  return (
    <MapSheet>
      <View style={styles.header}>
        <Pressable
          onPress={empty ? undefined : onToggleCollapsed}
          disabled={empty}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed, disabled: empty }}
          accessibilityLabel={empty ? 'No fences yet' : `Fences, ${items.length}. ${collapsed ? 'Show list' : 'Hide list'}`}
          style={styles.headerMain}>
          <MaterialCommunityIcons name="fence" size={22} color={Colors.primary} />
          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <Text variant="heading" numberOfLines={1}>
                {empty ? 'No fences yet' : 'Fences'}
              </Text>
              {empty ? null : <CountBadge count={items.length} tone="success" />}
            </View>
            <Text variant="caption" color="secondary" numberOfLines={2}>
              {empty ? 'Draw a boundary to start monitoring' : `${activeCount} active`}
            </Text>
          </View>
          {empty ? null : (
            <MaterialCommunityIcons
              name={collapsed ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={Colors.textSecondary}
            />
          )}
        </Pressable>
        <Button
          label="New fence"
          icon={isAdmin ? 'plus' : 'lock-outline'}
          size="sm"
          onPress={onCreate}
          accessibilityHint={isAdmin ? 'Opens fence drawing' : 'Only admins can draw fences'}
        />
      </View>
      {collapsed || empty ? null : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {items.map((it) => (
            <FenceRow key={it.id} item={it} onFocus={onFocus} onDelete={onDelete} isAdmin={isAdmin} />
          ))}
        </ScrollView>
      )}
    </MapSheet>
  );
}

const FenceRow = memo(function FenceRow({
  item,
  onFocus,
  onDelete,
  isAdmin,
}: {
  item: FenceListItem;
  onFocus: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  isAdmin: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onFocus(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Show ${item.name} on the map`}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
        <View style={[styles.swatch, !item.isActive && styles.swatchOff]} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.name}
          </Text>
          <Text variant="caption" color="secondary" numberOfLines={1} maxFontSizeMultiplier={A11y.controlFontScale}>
            {item.pointCount} points · {item.isActive ? 'Active' : 'Off'}
            {item.bufferMeters != null ? ` · warn ${Math.round(item.bufferMeters)} m` : ''}
          </Text>
        </View>
        <MaterialCommunityIcons name="crosshairs-gps" size={20} color={Colors.textSecondary} />
      </Pressable>
      {isAdmin ? (
        <IconButton
          icon="trash-can-outline"
          variant="danger"
          size={40}
          iconSize={20}
          onPress={() => onDelete(item.id, item.name)}
          accessibilityLabel={`Delete ${item.name}`}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    ...Shadows.raised,
  },
  toastIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primarySoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  headerMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  list: { flexShrink: 1, maxHeight: 260 },
  listContent: { paddingHorizontal: Spacing.sm, paddingTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingRight: Spacing.sm },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 52,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  rowPressed: { backgroundColor: Colors.surfaceSunken },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: MapPalette.fenceStroke,
    backgroundColor: MapPalette.fenceFill,
  },
  swatchOff: { borderColor: MapPalette.inactiveStroke, borderStyle: 'dashed', backgroundColor: MapPalette.inactiveFill },
});
