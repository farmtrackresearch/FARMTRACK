import { StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { StatTile } from '@/components/ui/StatTile';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { Colors, Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  fenceName: string;
  areaHectares: number;
  pointCount: number;
  /** Warning distance as typed (metres). */
  bufferMeters: string;
  onChangeBufferMeters: (value: string) => void;
  bufferValid: boolean;
  isActive: boolean;
  onChangeActive: (value: boolean) => void;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SaveBoundaryModal({
  visible,
  fenceName,
  areaHectares,
  pointCount,
  bufferMeters,
  onChangeBufferMeters,
  bufferValid,
  isActive,
  onChangeActive,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      dismissible={!saving}
      icon="check-decagram-outline"
      title="Save this boundary?"
      subtitle={fenceName}
      footer={
        <>
          <Button label="Back" variant="secondary" onPress={onCancel} disabled={saving} style={styles.flex} />
          <Button
            label={saving ? 'Saving…' : 'Save boundary'}
            onPress={onConfirm}
            loading={saving}
            disabled={!bufferValid}
            style={styles.flex}
          />
        </>
      }>
      <View style={styles.stats}>
        <StatTile variant="surface" icon="texture-box" label="hectares" value={areaHectares.toFixed(2)} />
        <StatTile variant="surface" icon="vector-point" label="points" value={pointCount} />
      </View>

      <TextField
        label="Warning distance (metres)"
        value={bufferMeters}
        onChangeText={onChangeBufferMeters}
        keyboardType="decimal-pad"
        placeholder="30"
        editable={!saving}
        accessibilityLabel="Warning distance in metres"
        error={bufferValid ? null : 'Enter a distance between 1 and 500 m.'}
        helper="Animals inside the fence but this close to its edge get a warning."
      />

      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text variant="captionStrong">Fence active</Text>
          <Text variant="caption" color="secondary">
            {isActive ? 'Animals are checked against this fence.' : 'Saved but ignored until switched on.'}
          </Text>
        </View>
        <Switch
          value={isActive}
          onValueChange={onChangeActive}
          disabled={saving}
          trackColor={{ true: Colors.primary, false: Colors.borderStrong }}
          thumbColor={Colors.surface}
          ios_backgroundColor={Colors.borderStrong}
          accessibilityLabel="Fence active"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stats: { flexDirection: 'row', gap: Spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48 },
});
