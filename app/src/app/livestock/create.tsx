import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Card';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useFarm } from '@/stores/FarmDataContext';
import type { HealthStatus } from '@/types/database';

const HEALTH: HealthStatus[] = ['healthy', 'monitoring', 'critical'];

export default function CreateLivestockScreen() {
  const router = useRouter();
  const { collars, livestock, upsertLivestock, isAdmin } = useFarm();

  const [name, setName] = useState('');
  const [tagId, setTagId] = useState('');
  const [breed, setBreed] = useState('Angus');
  const [age, setAge] = useState('3');
  const [health, setHealth] = useState<HealthStatus>('healthy');
  const [collarId, setCollarId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unpaired = collars.filter((c) => !livestock.some((l) => l.collar_id === c.id));

  const onSave = async () => {
    if (!isAdmin) {
      Alert.alert('Permission denied', 'Only admins can create livestock.');
      return;
    }
    if (!name.trim() || !tagId.trim() || !breed.trim()) {
      Alert.alert('Missing fields', 'Name, tag ID, and breed are required.');
      return;
    }
    try {
      setSaving(true);
      await upsertLivestock({
        name: name.trim(),
        tag_id: tagId.trim(),
        breed: breed.trim(),
        age: age ? Number(age) : null,
        health_status: health,
        collar_id: collarId,
      });
      router.back();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Add Animal' }} />

      <Field label="Display Name" value={name} onChangeText={setName} placeholder="Cow #410" />
      <Field label="Tag ID" value={tagId} onChangeText={setTagId} placeholder="410" />
      <Field label="Breed" value={breed} onChangeText={setBreed} placeholder="Angus" />
      <Field
        label="Age (years)"
        value={age}
        onChangeText={setAge}
        placeholder="3"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Health Status</Text>
      <View style={styles.chips}>
        {HEALTH.map((h) => (
          <Pressable
            key={h}
            onPress={() => setHealth(h)}
            style={[styles.chip, health === h && styles.chipActive]}>
            <Text style={[styles.chipText, health === h && styles.chipTextActive]}>{h}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Pair Collar</Text>
      <Pressable
        style={[styles.chip, !collarId && styles.chipActive, { marginBottom: 8 }]}
        onPress={() => setCollarId(null)}>
        <Text style={[styles.chipText, !collarId && styles.chipTextActive]}>Unpaired</Text>
      </Pressable>
      {unpaired.map((c) => (
        <Pressable
          key={c.id}
          style={[styles.chip, collarId === c.id && styles.chipActive, { marginBottom: 8 }]}
          onPress={() => setCollarId(c.id)}>
          <Text style={[styles.chipText, collarId === c.id && styles.chipTextActive]}>
            {c.device_hardware_id} · {c.battery_level}%
          </Text>
        </Pressable>
      ))}

      <Button
        label={saving ? 'Saving…' : 'Save Animal'}
        onPress={onSave}
        disabled={saving}
        style={{ marginTop: 16 }}
      />
    </ScrollView>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 40 },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { color: Colors.text, fontWeight: '600', textTransform: 'capitalize', fontSize: 13 },
  chipTextActive: { color: '#fff' },
});
