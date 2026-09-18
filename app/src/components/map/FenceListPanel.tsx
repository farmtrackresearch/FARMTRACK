import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

type UndoToastProps = {
  fenceName: string;
  onUndo: () => void;
  onDismiss?: () => void;
  timeoutMs?: number;
};

export function UndoFenceToast({
  fenceName,
  onUndo,
  onDismiss,
  timeoutMs = 8000,
}: UndoToastProps) {
  const insets = useSafeAreaInsets();
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
    <View
      style={[
        styles.toastWrap,
        { bottom: insets.bottom + 16 },
      ]}
      pointerEvents="box-none">
      <View style={styles.toastCard}>
        <View style={styles.toastIcon}>
          <MaterialCommunityIcons name="check-circle-outline" size={18} color={Colors.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.toastTitle}>Fence saved</Text>
          <Text style={styles.toastName} numberOfLines={1}>
            {fenceName}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setVisible(false);
            onDismiss?.();
            onUndo();
          }}
          style={styles.toastBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="undo-variant" size={16} color="#fff" />
          <Text style={styles.toastBtnText}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}

type FenceListItem = {
  id: string;
  name: string;
  pointCount: number;
  isActive: boolean;
  created_at?: string | null;
};

type FenceListPanelProps = {
  items: FenceListItem[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onFocus: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  isAdmin: boolean;
};

export function FenceListPanel({
  items,
  collapsed = false,
  onToggleCollapsed,
  onFocus,
  onDelete,
  isAdmin,
}: FenceListPanelProps) {
  if (items.length === 0) return null;

  return (
    <View style={styles.root}>
      <Pressable
        onPress={onToggleCollapsed}
        style={styles.header}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="vector-polygon" size={16} color={Colors.primaryDark} />
          <Text style={styles.headerTitle}>
            Fences ({items.length})
          </Text>
        </View>
        <MaterialCommunityIcons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={18}
          color={Colors.textSecondary}
        />
      </Pressable>
      {collapsed ? null : (
        <View style={styles.list}>
          {items.map((it) => (
            <View key={it.id} style={styles.row}>
              <Pressable
                onPress={() => onFocus(it.id)}
                style={styles.rowMain}
                hitSlop={{ top: 6, bottom: 6 }}>
                <View style={styles.rowDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {it.name}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {it.pointCount} vertices · {it.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="crosshairs-gps"
                  size={16}
                  color={Colors.textSecondary}
                />
              </Pressable>
              {isAdmin ? (
                <Pressable
                  onPress={() => onDelete(it.id, it.name)}
                  style={styles.deleteBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}>
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={16}
                    color={Colors.critical}
                  />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    alignItems: 'center',
    zIndex: 50,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.lg,
    width: '100%',
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(27,48,34,0.08)',
    ...Shadows.card,
  },
  toastIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(41,128,60,0.12)',
  },
  toastTitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  toastName: {
    fontSize: 14,
    color: Colors.primaryDark,
    fontWeight: '800',
    marginTop: 1,
  },
  toastBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.critical,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  toastBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  root: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.md,
    width: 240,
    maxHeight: 300,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    ...Shadows.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(27,48,34,0.08)',
    overflow: 'hidden',
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.surfaceMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(27,48,34,0.06)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.primaryDark,
    letterSpacing: 0.2,
  },
  list: {
    paddingTop: 4,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2D5A27',
    borderWidth: 2,
    borderColor: '#fff',
  },
  rowName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  rowMeta: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 1,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(198,40,40,0.08)',
  },
});
