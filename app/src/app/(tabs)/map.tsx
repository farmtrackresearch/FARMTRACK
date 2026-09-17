import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateFenceModal, type BoundaryTemplate } from '@/components/map/CreateFenceModal';
import { FenceDrawingPanel } from '@/components/map/FenceDrawingPanel';
import { FenceListPanel, UndoFenceToast } from '@/components/map/FenceListPanel';
import RanchMap from '@/components/map/RanchMap';
import type { RanchMapHandle } from '@/components/map/RanchMap.types';
import { SaveBoundaryModal } from '@/components/map/SaveBoundaryModal';
import { Colors, RANCH_REGION, Radius, Shadows, Spacing, Typography } from '@/constants/theme';
import { SectionEmoji } from '@/constants/navigation';
import {
  evaluateAgainstFences,
  FenceEval,
  geoJsonToLatLngs,
  isSelfIntersecting,
  makeEllipseTemplate,
  makeRectangleTemplate,
  polygonAreaHectares,
} from '@/lib/utils';
import { useAlarm } from '@/hooks/useAlarm';
import { useFarm } from '@/stores/FarmDataContext';
import type { MapLatLng } from '@/types/database';

function defaultFenceName(existingCount: number) {
  return `Fence ${existingCount + 1}`;
}

function humanMeters(m: number) {
  if (!isFinite(m)) return 'far';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  if (m < 10) return `${Math.max(0, Math.round(m))} m`;
  return `${Math.round(m)} m`;
}

/**
 * MapScreen — live livestock tracking + admin polygon geofence drawing +
 * real-time phone GPS monitor that fires a vibration + alert whenever
 * the device (or any saved livestock) steps outside or approaches a fence.
 */
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { createFence } = useLocalSearchParams<{ createFence?: string }>();
  const { locations, geofences, saveGeofence, deleteGeofence, isAdmin, recordFenceCrossing } = useFarm();
  const { triggerAlarm, dismissAlarm, activeAlarm } = useAlarm();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<MapLatLng[]>([]);
  const [fenceName, setFenceName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingFenceId, setEditingFenceId] = useState<string | null>(null);
  const [fenceListCollapsed, setFenceListCollapsed] = useState(false);
  const [undoCandidate, setUndoCandidate] = useState<{ id: string; name: string } | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const mapRef = useRef<RanchMapHandle>(null);

  const [deviceLoc, setDeviceLoc] = useState<MapLatLng | null>(null);
  const [deviceEval, setDeviceEval] = useState<FenceEval | null>(null);
  const [gpsPermDenied, setGpsPermDenied] = useState(false);
  const lastAlertAtRef = useRef<Record<string, number>>({});

  const activeFences = useMemo(
    () =>
      geofences
        .filter((g) => g.is_active)
        .map((g) => ({
          id: g.id,
          name: g.name,
          ring: geoJsonToLatLngs(g.coordinates.coordinates),
          warningBufferMeters: g.warning_buffer_meters ?? 30,
        })),
    [geofences]
  );

  const polygons = useMemo(
    () =>
      geofences
        .filter((g) => g.id !== editingFenceId)
        .map((g) => ({
          id: g.id,
          name: g.name,
          coords: geoJsonToLatLngs(g.coordinates.coordinates),
          warningBufferMeters: g.warning_buffer_meters ?? 30,
        })),
    [geofences, editingFenceId]
  );

  const selfIntersecting = useMemo(() => isSelfIntersecting(draftPoints), [draftPoints]);
  const draftAreaHectares = useMemo(() => polygonAreaHectares(draftPoints), [draftPoints]);

  // `initialRegion` on the native map only applies once, at first mount — before
  // fences/livestock have usually finished loading from Supabase. Once real data
  // shows up, snap the camera to it instead of leaving the map on the
  // hardcoded Montana placeholder (RANCH_REGION) forever. Runs once per screen mount.
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    const fenceCoords = polygons.flatMap((p) => p.coords);
    const coords =
      fenceCoords.length > 0
        ? fenceCoords
        : locations
            .filter((l) => l.latitude != null && l.longitude != null)
            .map((l) => ({ latitude: l.latitude as number, longitude: l.longitude as number }));
    if (coords.length === 0) return;
    hasAutoFitRef.current = true;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 60, bottom: 180, left: 60 },
      animated: false,
    });
  }, [polygons, locations]);

  useEffect(() => {
    if (createFence === '1' && isAdmin) {
      setEditingFenceId(null);
      setFenceName(defaultFenceName(geofences.length));
      setShowCreateModal(true);
      router.setParams({ createFence: undefined });
    }
  }, [createFence, geofences.length, isAdmin, router]);

  // Phone GPS listener: permission + subscription
  useEffect(() => {
    let mounted = true;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (mounted) setGpsPermDenied(true);
          return;
        }
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 2,
            timeInterval: 2000,
          },
          (update) => {
            if (!mounted) return;
            const pt: MapLatLng = {
              latitude: update.coords.latitude,
              longitude: update.coords.longitude,
            };
            setDeviceLoc(pt);

            // Silent evaluation first, only fire recordFenceCrossing when state changes
            // to avoid pushAlert / setLiveAlert churn on every tick.
            const nextEval = activeFences.length
              ? evaluateAgainstFences(pt, activeFences)
              : {
                  state: 'grazing' as const,
                  fenceId: null,
                  fenceName: null,
                  distanceMeters: Number.POSITIVE_INFINITY,
                  insideAnyFence: false,
                };

            const prev = deviceEvalRef.current;
            const transition =
              !prev || prev.state !== nextEval.state || prev.fenceId !== nextEval.fenceId;
            if (transition && (nextEval.state === 'breach' || nextEval.state === 'warning')) {
              const key = `${nextEval.state}-${nextEval.fenceId ?? 'any'}`;
              const now = Date.now();
              const last = lastAlertAtRef.current[key] ?? 0;
              const silent = now - last < 30_000;
              if (!silent) {
                lastAlertAtRef.current[key] = now;
                void triggerAlarm({
                  severity: nextEval.state === 'breach' ? 'breach' : 'warning',
                  title:
                    nextEval.state === 'breach'
                      ? nextEval.fenceName
                        ? `You left ${nextEval.fenceName}`
                        : 'Fence breach detected'
                      : nextEval.fenceName
                        ? `Approaching ${nextEval.fenceName} edge`
                        : 'Approaching fence boundary',
                  message: nextEval.fenceName
                    ? `Your device is ~${Math.round(nextEval.distanceMeters)}m from the boundary of ${nextEval.fenceName}.`
                    : `Your device is ~${Math.round(nextEval.distanceMeters)}m from the nearest active fence.`,
                  fenceName: nextEval.fenceName,
                  sourceId: 'phone',
                });
              }
              recordFenceCrossing(pt, {
                subjectId: 'phone',
                subjectName: 'Your device',
                silent,
              });
            } else if (
              transition &&
              prev &&
              (prev.state === 'breach' || prev.state === 'warning') &&
              nextEval.state === 'inside'
            ) {
              if (activeAlarm?.sourceId === 'phone') {
                void dismissAlarm();
              }
              Vibration.vibrate(50);
            }

            deviceEvalRef.current = nextEval;
            setDeviceEval(nextEval);
          }
        );
      } catch (err) {
        console.warn('[MapScreen] GPS watch failed:', err);
      }
    })();

    return () => {
      mounted = false;
      if (sub) sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFences.length]);

  const deviceEvalRef = useRef<FenceEval | null>(null);

  const openCreateModal = () => {
    if (!isAdmin) {
      Alert.alert('Read-only', 'Staff can view the map but only admins can draw fences.');
      return;
    }
    setEditingFenceId(null);
    setFenceName(defaultFenceName(geofences.length));
    setShowCreateModal(true);
  };

  const startDrawing = () => {
    setShowCreateModal(false);
    setDrawing(true);
    if (!editingFenceId) setDraftPoints([]);
  };

  const startDrawingFromTemplate = (shape: BoundaryTemplate) => {
    const center = mapRef.current?.getCenter() ?? RANCH_REGION;
    const points =
      shape === 'rectangle'
        ? makeRectangleTemplate(center)
        : shape === 'circle'
          ? makeEllipseTemplate(center, 55, 55)
          : makeEllipseTemplate(center, 75, 40);
    setEditingFenceId(null);
    setDraftPoints(points);
    setShowCreateModal(false);
    setDrawing(true);
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setDraftPoints([]);
    setEditingFenceId(null);
  };

  const startEditingFence = (id: string) => {
    const fence = geofences.find((g) => g.id === id);
    if (!fence) return;
    const coords = geoJsonToLatLngs(fence.coordinates.coordinates);
    // Polygon ring wraps back to the start; drop the duplicate closing vertex for editing.
    const unique = coords.length > 2
      ? coords.filter(
          (c, i, arr) =>
            i === 0 ||
            i !== arr.length - 1 ||
            Math.abs(c.latitude - arr[0].latitude) > 1e-6 ||
            Math.abs(c.longitude - arr[0].longitude) > 1e-6
        )
      : coords;
    setEditingFenceId(id);
    setFenceName(fence.name);
    setDraftPoints(unique);
    setShowCreateModal(false);
    setDrawing(true);
  };

  const onPressCoordinate = (coord: MapLatLng) => {
    if (!drawing || !isAdmin) return;
    setDraftPoints((prev) => [...prev, coord]);
  };

  const undoLastPoint = () => {
    setDraftPoints((prev) => prev.slice(0, -1));
  };

  const clearAllPoints = () => {
    if (draftPoints.length === 0) return;
    Alert.alert(
      'Clear and restart?',
      'This removes all placed points so you can start the boundary over.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => setDraftPoints([]) },
      ]
    );
  };

  const onDragVertex = (index: number, coord: MapLatLng) => {
    if (!drawing || !isAdmin) return;
    setDraftPoints((prev) => prev.map((p, i) => (i === index ? coord : p)));
  };

  const onDeleteVertex = (index: number) => {
    if (!drawing || !isAdmin) return;
    setDraftPoints((prev) => prev.filter((_, i) => i !== index));
  };

  const requestSave = () => {
    if (draftPoints.length < 3) {
      Alert.alert('Need more points', 'Tap at least 3 points to close a virtual fence.');
      return;
    }
    if (selfIntersecting) {
      Alert.alert(
        'Boundary lines cross',
        'This shape crosses over itself. Drag the points so the outline no longer crosses, then try saving again.'
      );
      return;
    }
    setShowSaveConfirm(true);
  };

  const confirmSave = async () => {
    setShowSaveConfirm(false);
    await performSave();
  };

  const performSave = async () => {
    const name = fenceName.trim() || 'Untitled Fence';
    try {
      setSaving(true);
      const savedCoords: MapLatLng[] = [...draftPoints];
      const savedId = await saveGeofence(name, draftPoints, editingFenceId ?? undefined);
      const wasNew = !editingFenceId;
      setDrawing(false);
      setDraftPoints([]);
      setEditingFenceId(null);
      // Make the just-saved fence instantly visible on the map.
      // Use setTimeout so state commits to state + polygons prop re-render first.
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(savedCoords, {
          edgePadding: { top: 80, right: 60, bottom: 180, left: 60 },
          animated: true,
        });
      }, 50);
      if (wasNew) {
        setUndoCandidate({ id: savedId, name });
      } else {
        setUndoCandidate(null);
      }
      if (wasNew) {
        Alert.alert('Fence saved', `${name} is now active.`, [
          { text: 'Show me', onPress: () => mapRef.current?.fitToCoordinates(savedCoords) },
          { text: 'OK', style: 'cancel' },
        ]);
      } else {
        Alert.alert('Fence updated', `${name} has been saved.`);
      }
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const focusFence = (id: string) => {
    const f = geofences.find((g) => g.id === id);
    if (!f) return;
    const coords = geoJsonToLatLngs(f.coordinates.coordinates);
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 60, bottom: 120, left: 60 },
    });
  };

  const onDeleteFence = (id: string, name: string) => {
    Alert.alert(
      `Delete ${name}?`,
      'This virtual fence will be removed and animals will no longer be monitored against it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGeofence(id);
              if (undoCandidate?.id === id) setUndoCandidate(null);
            } catch (err) {
              Alert.alert('Delete failed', err instanceof Error ? err.message : 'Unknown error');
            }
          },
        },
      ]
    );
  };

  const undoLastSave = async () => {
    if (!undoCandidate) return;
    try {
      await deleteGeofence(undoCandidate.id);
    } catch (err) {
      Alert.alert('Undo failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUndoCandidate(null);
    }
  };

  const onFencePress = (id: string, name: string) => {
    if (!isAdmin) {
      focusFence(id);
      return;
    }
    if (drawing) return;
    Alert.alert(name, 'Manage this virtual fence', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Zoom here', onPress: () => focusFence(id) },
      {
        text: 'Edit Shape',
        style: 'default',
        onPress: () => startEditingFence(id),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => onDeleteFence(id, name),
      },
    ]);
  };

  const probeBadgeTone =
    !deviceEval || deviceEval.state === 'grazing'
      ? styles.probeSafe
      : deviceEval.state === 'inside'
        ? styles.probeInside
        : deviceEval.state === 'warning'
          ? styles.probeWarning
          : styles.probeBreach;

  const probeLabel =
    !deviceEval || gpsPermDenied
      ? 'GPS off'
      : deviceEval.state === 'inside'
        ? `${deviceEval.fenceName ? deviceEval.fenceName + ' · ' : ''}safe · ${humanMeters(deviceEval.distanceMeters)} from edge`
        : deviceEval.state === 'warning'
          ? `⚠ Near ${deviceEval.fenceName ?? 'fence'} · ${humanMeters(deviceEval.distanceMeters)}`
          : deviceEval.state === 'breach'
            ? `🚨 Outside ${deviceEval.fenceName ?? 'pasture'} · ${humanMeters(deviceEval.distanceMeters)}`
            : `Looking for fences… ${humanMeters(deviceEval.distanceMeters)}`;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{SectionEmoji.map} Live Map</Text>
          <Text style={styles.subtitle}>Real-time livestock tracking</Text>
          <View style={[styles.probe, probeBadgeTone]}>
            <MaterialCommunityIcons
              name={
                !deviceEval || gpsPermDenied
                  ? 'crosshairs-off'
                  : deviceEval.state === 'breach'
                    ? 'alert-decagram'
                    : deviceEval.state === 'warning'
                      ? 'alert-circle-outline'
                      : 'crosshairs-gps'
              }
              size={14}
              color={
                !deviceEval || gpsPermDenied
                  ? Colors.textSecondary
                  : deviceEval.state === 'breach' || deviceEval.state === 'warning'
                    ? '#fff'
                    : Colors.primaryDark
              }
            />
            <Text
              numberOfLines={1}
              style={[
                styles.probeText,
                (!deviceEval || gpsPermDenied) && { color: Colors.textSecondary },
                (deviceEval?.state === 'breach' || deviceEval?.state === 'warning') && {
                  color: '#fff',
                },
              ]}>
              {probeLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.mapWrap}>
        <RanchMap
          ref={mapRef}
          locations={locations}
          polygons={polygons}
          draftPoints={draftPoints}
          drawing={drawing}
          onPressCoordinate={onPressCoordinate}
          onDragVertex={onDragVertex}
          onDeleteVertex={onDeleteVertex}
          onMarkerPress={(id) => router.push(`/livestock/${id}`)}
          onFencePress={onFencePress}
        />

        {!drawing ? (
          <FenceListPanel
            items={polygons.map((p) => {
              const raw = geofences.find((g) => g.id === p.id);
              return {
                id: p.id,
                name: p.name,
                pointCount: p.coords.length,
                isActive: raw?.is_active ?? true,
              };
            })}
            collapsed={fenceListCollapsed}
            onToggleCollapsed={() => setFenceListCollapsed((v) => !v)}
            onFocus={focusFence}
            onDelete={onDeleteFence}
            isAdmin={Boolean(isAdmin)}
          />
        ) : null}

        {undoCandidate && !drawing ? (
          <UndoFenceToast
            fenceName={undoCandidate.name}
            onUndo={undoLastSave}
            onDismiss={() => setUndoCandidate(null)}
          />
        ) : null}

        {drawing ? (
          <FenceDrawingPanel
            fenceName={fenceName.trim() || 'Untitled Fence'}
            pointCount={draftPoints.length}
            saving={saving}
            selfIntersecting={selfIntersecting}
            onClose={cancelDrawing}
            onSave={requestSave}
            onUndo={undoLastPoint}
            onClearAll={clearAllPoints}
            canUndo={draftPoints.length > 0}
            isEditing={Boolean(editingFenceId)}
          />
        ) : (
          <Pressable style={styles.fab} onPress={openCreateModal}>
            <MaterialCommunityIcons name="plus" size={28} color="#fff" />
          </Pressable>
        )}
      </View>

      <CreateFenceModal
        visible={showCreateModal}
        fenceName={fenceName}
        onChangeName={setFenceName}
        onCancel={() => setShowCreateModal(false)}
        onStartDrawing={startDrawing}
        onSelectTemplate={startDrawingFromTemplate}
      />

      <SaveBoundaryModal
        visible={showSaveConfirm}
        fenceName={fenceName.trim() || 'Untitled Fence'}
        areaHectares={draftAreaHectares}
        pointCount={draftPoints.length}
        saving={saving}
        onCancel={() => setShowSaveConfirm(false)}
        onConfirm={confirmSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
  },
  title: { ...Typography.h1, fontSize: 26, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  probe: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.sm,
  },
  probeSafe: {
    backgroundColor: Colors.surfaceVariant,
  },
  probeInside: {
    backgroundColor: '#E3F1DC',
  },
  probeWarning: {
    backgroundColor: Colors.warning,
  },
  probeBreach: {
    backgroundColor: Colors.critical,
  },
  probeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  mapWrap: { flex: 1 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
  },
});
