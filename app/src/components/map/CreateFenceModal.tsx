import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Card';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

export type BoundaryTemplate = 'rectangle' | 'circle' | 'oval';

type Props = {
  visible: boolean;
  fenceName: string;
  onChangeName: (name: string) => void;
  onCancel: () => void;
  onStartDrawing: () => void;
  onSelectTemplate: (shape: BoundaryTemplate) => void;
};

const TEMPLATES: {
  shape: BoundaryTemplate;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  { shape: 'rectangle', label: 'Rectangle', icon: 'rectangle-outline' },
  { shape: 'circle', label: 'Circle', icon: 'circle-outline' },
  { shape: 'oval', label: 'Oval', icon: 'ellipse-outline' },
];

export function CreateFenceModal({
  visible,
  fenceName,
  onChangeName,
  onCancel,
  onStartDrawing,
  onSelectTemplate,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="shield-outline" size={22} color={Colors.textSecondary} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Create New Fence</Text>
              <Text style={styles.subtitle}>Tap the map to draw your boundary</Text>
            </View>
          </View>

          <Text style={styles.label}>Fence Name</Text>
          <TextInput
            value={fenceName}
            onChangeText={onChangeName}
            style={styles.input}
            placeholder="Fence 1"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="alert" size={18} color={Colors.warning} />
            <Text style={styles.infoText}>
              Audio warnings activate at 15m and correction pulses at 5m from the boundary.
              Place at least 3 points.
            </Text>
          </View>

          <View style={styles.actions}>
            <Button label="Cancel" variant="outline" onPress={onCancel} style={styles.actionBtn} />
            <Button label="Start Drawing" onPress={onStartDrawing} style={styles.actionBtn} />
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or start from a shape</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.templateRow}>
            {TEMPLATES.map((t) => (
              <Pressable
                key={t.shape}
                style={styles.templateCard}
                onPress={() => onSelectTemplate(t.shape)}>
                <MaterialCommunityIcons name={t.icon} size={28} color={Colors.primary} />
                <Text style={styles.templateLabel}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
    ...Shadows.card,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  label: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: '#E8F4FD',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  actions: { flexDirection: 'row', gap: Spacing.md },
  actionBtn: { flex: 1 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  templateRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  templateCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceMuted,
  },
  templateLabel: { fontSize: 13, fontWeight: '700', color: Colors.text },
});
