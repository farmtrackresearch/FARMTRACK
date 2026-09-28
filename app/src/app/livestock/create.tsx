import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/ui/AppHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { ToneColors } from '@/components/ui/tones';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { batteryLabel } from '@/lib/utils';
import { useFarm } from '@/stores/FarmDataContext';
import type { HealthStatus, Livestock } from '@/types/database';

const HEALTH: { value: HealthStatus; label: string; color: string }[] = [
  { value: 'healthy', label: 'Healthy', color: ToneColors.success.color },
  { value: 'monitoring', label: 'Monitoring', color: ToneColors.warning.color },
  { value: 'critical', label: 'Critical', color: ToneColors.critical.color },
];

/**
 * Add or edit an animal.
 * - `/livestock/create`: new animal.
 * - `/livestock/create?id=<livestock id>`: edit that animal.
 * - `/livestock/create?collarId=<collar id>`: pair that collar, either with an
 *   existing animal that has no collar or with a new one (Hardware tab "Pair").
 */
export default function CreateLivestockScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; collarId?: string }>();
  const { collars, livestock, upsertLivestock, isAdmin } = useFarm();

  const [editingId, setEditingId] = useState<string | null>(params.id ?? null);
  const editing = editingId ? livestock.find((l) => l.id === editingId) : undefined;

  const [name, setName] = useState(editing?.name ?? '');
  const [tagId, setTagId] = useState(editing?.tag_id ?? '');
  const [breed, setBreed] = useState(editing?.breed ?? '');
  const [age, setAge] = useState(editing?.age != null ? String(editing.age) : '');
  const [health, setHealth] = useState<HealthStatus>(editing?.health_status ?? 'healthy');
  const [collarId, setCollarId] = useState<string | null>(params.collarId ?? editing?.collar_id ?? null);
  const [saving, setSaving] = useState(false);

  // Collars free to pair, plus the one this animal already wears.
  const pairable = collars.filter(
    (c) => c.id === editing?.collar_id || !livestock.some((l) => l.collar_id === c.id)
  );
  const animalsWithoutCollar = livestock.filter((l) => !l.collar_id);
  const pairingCollar = params.collarId ? collars.find((c) => c.id === params.collarId) : undefined;

  const loadAnimal = (animal: Livestock) => {
    setEditingId(animal.id);
    setName(animal.name);
    setTagId(animal.tag_id);
    setBreed(animal.breed);
    setAge(animal.age != null ? String(animal.age) : '');
    setHealth(animal.health_status);
  };

  const onSave = async () => {
    if (!isAdmin) {
      Alert.alert('Permission denied', 'Only admins can add or edit livestock.');
      return;
    }
    if (!name.trim() || !tagId.trim() || !breed.trim()) {
      Alert.alert('Missing fields', 'Name, tag ID, and breed are required.');
      return;
    }
    const ageValue = age.trim() === '' ? null : Number(age.replace(',', '.'));
    if (ageValue !== null && (!Number.isFinite(ageValue) || ageValue < 0 || ageValue > 99)) {
      Alert.alert('Check the age', 'Enter the age in years, for example 3 or 2.5.');
      return;
    }
    try {
      setSaving(true);
      await upsertLivestock({
        id: editingId ?? undefined,
        name: name.trim(),
        tag_id: tagId.trim(),
        breed: breed.trim(),
        age: ageValue,
        health_status: health,
        collar_id: collarId,
      });
      router.back();
    } catch (err) {
      // Stay on the form so nothing typed is lost.
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const title = editingId ? 'Edit animal' : pairingCollar ? 'Pair collar' : 'Add animal';

  if (params.id && !editing) {
    return (
      <Screen header={<AppHeader variant="stack" inScroll onBack={() => router.back()} title="Not found" />}>
        <EmptyState title="This animal no longer exists." message="It may have been deleted on another phone." />
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      header={
        <AppHeader
          variant="stack"
          inScroll
          onBack={() => router.back()}
          overline="Livestock"
          title={title}
          subtitle={editing ? editing.name : undefined}
        />
      }>
      {pairingCollar && !params.id ? (
        <Card style={styles.pairCard}>
          <Text variant="heading" color={Colors.infoInk}>
            Pairing collar {pairingCollar.device_hardware_id}
          </Text>
          {animalsWithoutCollar.length > 0 ? (
            <>
              <Text variant="caption" color="secondary">
                Pick an animal without a collar, or fill in a new animal below.
              </Text>
              <View style={styles.chips}>
                {animalsWithoutCollar.map((animal) => (
                  <Chip
                    key={animal.id}
                    label={`${animal.name} · ${animal.tag_id}`}
                    selected={editingId === animal.id}
                    onPress={() => loadAnimal(animal)}
                  />
                ))}
              </View>
            </>
          ) : (
            <Text variant="caption" color="secondary">
              Every animal already has a collar. Add a new animal below.
            </Text>
          )}
        </Card>
      ) : null}

      <View style={styles.group}>
        <Text variant="overline" color="secondary">
          Animal
        </Text>
        <TextField label="Display name" value={name} onChangeText={setName} placeholder="Cow #410" returnKeyType="next" />
        <TextField
          label="Tag ID"
          value={tagId}
          onChangeText={setTagId}
          placeholder="410"
          autoCapitalize="characters"
          returnKeyType="next"
        />
        <TextField label="Breed" value={breed} onChangeText={setBreed} placeholder="Angus" returnKeyType="next" />
        <TextField
          label="Age (years)"
          value={age}
          onChangeText={setAge}
          placeholder="3"
          keyboardType="decimal-pad"
          helper="Optional. For example 3 or 2.5."
        />
      </View>

      <View style={styles.group}>
        <Text variant="overline" color="secondary">
          Health status
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {HEALTH.map((h) => (
            <Chip
              key={h.value}
              label={h.label}
              dotColor={h.color}
              selected={health === h.value}
              onPress={() => setHealth(h.value)}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text variant="overline" color="secondary">
          Collar
        </Text>
        <View style={styles.collarList} accessibilityRole="radiogroup">
          <Chip block label="No collar" icon="link-variant-off" selected={!collarId} onPress={() => setCollarId(null)} />
          {pairable.map((c) => (
            <Chip
              key={c.id}
              block
              label={c.device_hardware_id}
              detail={`Battery ${batteryLabel(c.battery_level)}`}
              icon="access-point"
              selected={collarId === c.id}
              onPress={() => setCollarId(c.id)}
            />
          ))}
        </View>
      </View>

      <Button
        label={saving ? 'Saving…' : editingId ? 'Save changes' : 'Save animal'}
        icon="content-save-outline"
        loading={saving}
        onPress={onSave}
        disabled={!isAdmin}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pairCard: { backgroundColor: Colors.infoSoft, borderColor: Colors.infoSoft, gap: Spacing.sm, borderRadius: Radius.lg },
  group: { gap: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  collarList: { gap: Spacing.sm },
});
