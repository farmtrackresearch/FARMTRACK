import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import type { IconName } from '@/components/ui/tones';
import { A11y, Colors, Radius, Spacing } from '@/constants/theme';

export type BoundaryTemplate = 'rectangle' | 'circle' | 'oval';

type Props = {
  visible: boolean;
  fenceName: string;
  onChangeName: (name: string) => void;
  onCancel: () => void;
  onStartDrawing: () => void;
  onSelectTemplate: (shape: BoundaryTemplate) => void;
};

const TEMPLATES: { shape: BoundaryTemplate; label: string; icon: IconName }[] = [
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
    <Sheet
      visible={visible}
      onClose={onCancel}
      icon="fence"
      title="Create new fence"
      subtitle="Tap the map to draw your boundary">
      <TextField label="Fence name" value={fenceName} onChangeText={onChangeName} placeholder="Fence 1" />

      <Banner
        tone="info"
        icon="information-outline"
        title="How fences work"
        message={
          "Animals get a warning beep when they come within the fence's warning distance of the edge " +
          '(30 m unless you change it when saving), and a breach alarm once they are outside every fence. ' +
          'Place at least 3 points.'
        }
      />

      <View style={styles.actions}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.flex} />
        <Button label="Start drawing" onPress={onStartDrawing} style={styles.flex} />
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text variant="caption" color="secondary">
          or start from a shape
        </Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.templates}>
        {TEMPLATES.map((t) => (
          <Pressable
            key={t.shape}
            onPress={() => onSelectTemplate(t.shape)}
            accessibilityRole="button"
            accessibilityLabel={`Start from a ${t.label.toLowerCase()}`}
            style={({ pressed }) => [styles.template, pressed && styles.templatePressed]}>
            <MaterialCommunityIcons name={t.icon} size={28} color={Colors.primary} />
            <Text variant="captionStrong" maxFontSizeMultiplier={A11y.controlFontScale}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.borderStrong },
  templates: { flexDirection: 'row', gap: Spacing.md },
  template: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 88,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  templatePressed: { backgroundColor: Colors.primarySoft, borderColor: Colors.primary },
});
