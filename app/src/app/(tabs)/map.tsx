import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Vibration, View } from 'react-native';

import { CreateFenceModal, type BoundaryTemplate } from '@/components/map/CreateFenceModal';
import { FenceDrawingPanel } from '@/components/map/FenceDrawingPanel';
import { FenceListPanel, UndoFenceToast } from '@/components/map/FenceListPanel';
import { MapControls, mapControlsHeight } from '@/components/map/MapControls';
import { MapLegend } from '@/components/map/MapLegend';
import { PositionChip, type PositionChipState } from '@/components/map/PositionChip';
import RanchMap, { mapAttribution } from '@/components/map/RanchMap';
import type { MapAnimal, MapAppearance, RanchMapHandle } from '@/components/map/RanchMap.types';
import { SaveBoundaryModal } from '@/components/map/SaveBoundaryModal';
import { AppHeader } from '@/components/ui/AppHeader';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Layout, MapPalette, RANCH_REGION, Radius, Spacing } from '@/constants/theme';
import {
  DEFAULT_WARNING_BUFFER_M,
  evaluateAgainstFences,
  FenceEval,
  geoJsonToLatLngs,
  haversineMeters,
  isSelfIntersecting,
  isStale,
  makeEllipseTemplate,
  makeRectangleTemplate,
  openRing,
  polygonAreaHectares,
} from '@/lib/utils';
import { useFarm } from '@/stores/FarmDataContext';
import type { AnimalStatus, LivestockLocation, MapLatLng } from '@/types/database';

function defaultFenceName(existingCount: number) {
  return `Fence ${existingCount + 1}`;
}

function humanMeters(m: number) {
  if (!isFinite(m)) return 'far';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  if (m < 10) return `${Math.max(0, Math.round(m))} m`;
  return `${Math.round(m)} m`;
}

// A stationary animal still gets a fresh GPS estimate every few seconds, and
// consumer GPS carries a few metres of error, so the marker would crawl around
// even when nothing moved. Hold the drawn position until the animal has really
// travelled further than that noise floor. Display only: the server judges
// every reading for fence state.
const STABLE_THRESHOLD_M = 6;

function holdPositions(prev: Record<string, MapLatLng>, locations: LivestockLocation[]) {
  const next: Record<string, MapLatLng> = {};
  for (const l of locations) {
    if (l.latitude == null || l.longitude == null) continue;
    const incoming: MapLatLng = { latitude: l.latitude, longitude: l.longitude };
    const held = prev[l.livestock_id];
    next[l.livestock_id] = held && haversineMeters(held, incoming) < STABLE_THRESHOLD_M ? held : incoming;
  }
  return next;
}

/**
 * MapScreen — live livestock positions (fence state decided by the server),
 * admin polygon fence drawing, and an opt-in check of the phone's own
 * position against the fences (its own banner; never the livestock siren).
 */
export default function MapScreen() {
  const router = useRouter();
  const { createFence } = useLocalSearchParams<{ createFence?: string }>();
  const { locations, geofences, saveGeofence, deleteGeofence, isAdmin, now } = useFarm();

  const [mapType, setMapType] = useState<MapAppearance>('standard');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<MapLatLng[]>([]);
  const [fenceName, setFenceName] = useState('');
  const [fenceBuffer, setFenceBuffer] = useState(String(DEFAULT_WARNING_BUFFER_M));
  const [fenceActive, setFenceActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingFenceId, setEditingFenceId] = useState<string | null>(null);
  // Collapsed by default so the map, not the list, fills the screen.
  const [fenceListCollapsed, setFenceListCollapsed] = useState(true);
  const [undoCandidate, setUndoCandidate] = useState<{ id: string; name: string } | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const mapRef = useRef<RanchMapHandle>(null);

  const [checkMyPosition, setCheckMyPosition] = useState(false);
  const [deviceLoc, setDeviceLoc] = useState<MapLatLng | null>(null);
  const [deviceEval, setDeviceEval] = useState<FenceEval | null>(null);
  const [gpsPermDenied, setGpsPermDenied] = useState(false);

  const activeFences = useMemo(
    () =>
      geofences
        .filter((g) => g.is_active)
        .map((g) => ({
          id: g.id,
          name: g.name,
          ring: geoJsonToLatLngs(g.coordinates.coordinates),
          warningBufferMeters: g.warning_buffer_meters ?? DEFAULT_WARNING_BUFFER_M,
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
          warningBufferMeters: g.warning_buffer_meters ?? DEFAULT_WARNING_BUFFER_M,
          isActive: g.is_active,
        })),
    [geofences, editingFenceId]
  );

  const selfIntersecting = useMemo(() => isSelfIntersecting(draftPoints), [draftPoints]);
  const draftAreaHectares = useMemo(() => polygonAreaHectares(draftPoints), [draftPoints]);

  // Derived from the previous render's held positions (React's "store info
  // from previous renders" pattern) instead of mutating a ref inside useMemo.
  const [heldFor, setHeldFor] = useState(locations);
  const [heldPositions, setHeldPositions] = useState(() => holdPositions({}, locations));
  if (heldFor !== locations) {
    setHeldFor(locations);
    setHeldPositions(holdPositions(heldPositions, locations));
  }

  const mapAnimals = useMemo<MapAnimal[]>(
    () =>
      locations.map((l) => {
        const held = heldPositions[l.livestock_id];
        return {
          ...l,
          latitude: held?.latitude ?? l.latitude,
          longitude: held?.longitude ?? l.longitude,
          stale: isStale(l.last_seen_at, now),
        };
      }),
    [locations, heldPositions, now]
  );

  // Frame the collars, not the phone. Fence corners are included so an animal
  // and the fence it is judged against are visible together. The camera
  // starts on RANCH_REGION and moves here once data first arrives.
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    const collarCoords = mapAnimals
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({ latitude: l.latitude as number, longitude: l.longitude as number }));
    const fenceCoords = polygons.flatMap((p) => p.coords);
    // Fences alone are still a sensible frame before any collar has reported.
    const coords = collarCoords.length > 0 ? [...collarCoords, ...fenceCoords] : fenceCoords;
    if (coords.length === 0) return;
    hasAutoFitRef.current = true;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 60, bottom: 180, left: 60 },
      animated: false,
    });
  }, [polygons, mapAnimals]);

  // Dashboard "Create New Fence" arrives as ?createFence=1: open the create
  // sheet once (state adjusted during render), then clear the param.
  const wantsCreate = createFence === '1' && isAdmin;
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (wantsCreate !== createRequestSeen) {
    setCreateRequestSeen(wantsCreate);
    if (wantsCreate) {
      setEditingFenceId(null);
      setFenceName(defaultFenceName(geofences.length));
      setFenceBuffer(String(DEFAULT_WARNING_BUFFER_M));
      setFenceActive(true);
      setShowCreateModal(true);
    }
  }
  useEffect(() => {
    if (createFence === '1') router.setParams({ createFence: undefined });
  }, [createFence, router]);

  // Phone position check. Opt-in, and only while this tab is focused, so the
  // app never tracks the farmer in the background. The watcher reads fences
  // and the previous status from refs, so it never works on stale values.
  const activeFencesRef = useRef(activeFences);
  const deviceStatusRef = useRef<AnimalStatus | null>(null);
  useEffect(() => {
    activeFencesRef.current = activeFences;
  }, [activeFences]);

  useFocusEffect(
    useCallback(() => {
      if (!checkMyPosition) return;
      let cancelled = false;
      let sub: Location.LocationSubscription | null = null;

      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (status !== 'granted') {
            setGpsPermDenied(true);
            setCheckMyPosition(false);
            return;
          }
          setGpsPermDenied(false);
          const watcher = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, distanceInterval: 2, timeInterval: 2000 },
            (update) => {
              if (cancelled) return;
              const pt: MapLatLng = {
                latitude: update.coords.latitude,
                longitude: update.coords.longitude,
              };
              const prev = deviceStatusRef.current;
              const ev = evaluateAgainstFences(pt, activeFencesRef.current, prev);
              deviceStatusRef.current = ev.status;
              if (prev !== null && prev !== ev.status && (ev.status === 'breach' || ev.status === 'near_boundary')) {
                Vibration.vibrate(200);
              }
              setDeviceLoc(pt);
              setDeviceEval(ev);
            }
          );
          // The screen lost focus or unmounted while we were waiting.
          if (cancelled) watcher.remove();
          else sub = watcher;
        } catch (err) {
          console.warn('[MapScreen] GPS watch failed:', err);
        }
      })();

      return () => {
        cancelled = true;
        sub?.remove();
        sub = null;
        // Also drop the last fix: while it is set the map keeps <UserLocation/>
        // mounted, which runs native GPS even on other tabs.
        setDeviceLoc(null);
        setDeviceEval(null);
      };
    }, [checkMyPosition])
  );

  const togglePositionCheck = () => {
    if (checkMyPosition) {
      setCheckMyPosition(false);
      setDeviceLoc(null);
      setDeviceEval(null);
      deviceStatusRef.current = null;
    } else {
      setCheckMyPosition(true);
    }
  };

  const openCreateModal = () => {
    if (!isAdmin) {
      Alert.alert('Read-only', 'Staff can view the map but only admins can draw fences.');
      return;
    }
    setEditingFenceId(null);
    setFenceName(defaultFenceName(geofences.length));
    setFenceBuffer(String(DEFAULT_WARNING_BUFFER_M));
    setFenceActive(true);
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
    // Polygon ring wraps back to the start; drop the duplicate closing vertex for editing.
    const unique = openRing(geoJsonToLatLngs(fence.coordinates.coordinates));
    setEditingFenceId(id);
    setFenceName(fence.name);
    setFenceBuffer(String(fence.warning_buffer_meters ?? DEFAULT_WARNING_BUFFER_M));
    setFenceActive(fence.is_active);
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

  const parsedBuffer = Number(fenceBuffer.replace(',', '.'));
  const bufferValid = fenceBuffer.trim() !== '' && Number.isFinite(parsedBuffer) && parsedBuffer >= 1 && parsedBuffer <= 500;

  const confirmSave = async () => {
    if (!bufferValid) {
      Alert.alert('Check the warning distance', 'Enter a warning distance between 1 and 500 metres.');
      return;
    }
    setShowSaveConfirm(false);
    await performSave();
  };

  // On failure the drawing stays open with every point intact, so the admin
  // can fix the problem and save again.
  const performSave = async () => {
    const name = fenceName.trim() || 'Untitled Fence';
    try {
      setSaving(true);
      const savedCoords: MapLatLng[] = [...draftPoints];
      const savedId = await saveGeofence({
        id: editingFenceId ?? undefined,
        name,
        points: draftPoints,
        isActive: fenceActive,
        warningBufferMeters: parsedBuffer,
      });
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
        Alert.alert('Fence saved', fenceActive ? `${name} is now active.` : `${name} is saved but switched off.`, [
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
    if (drawing) return;
    focusFence(id);
    if (!isAdmin) return;
    // Android shows at most three alert buttons, so zooming happens on tap.
    Alert.alert(name, 'Manage this virtual fence', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Edit', onPress: () => startEditingFence(id) },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteFence(id, name) },
    ]);
  };

  const probe = ((): PositionChipState => {
    if (!checkMyPosition) {
      return gpsPermDenied
        ? { kind: 'denied', label: 'Location permission denied' }
        : { kind: 'off', label: 'Check my position' };
    }
    if (!deviceEval) return { kind: 'finding', label: 'Finding your position…' };
    const where = deviceEval.fenceName ?? 'the fence';
    switch (deviceEval.status) {
      case 'breach':
        return { kind: 'breach', label: `You are outside ${where} · ${humanMeters(deviceEval.distanceMeters)}` };
      case 'near_boundary':
        return { kind: 'near', label: `Near the edge of ${where} · ${humanMeters(deviceEval.distanceMeters)}` };
      default:
        return deviceEval.fenceId
          ? { kind: 'inside', label: `Inside ${where} · ${humanMeters(deviceEval.distanceMeters)} from the edge` }
          : { kind: 'none', label: 'No active fences' };
    }
  })();

  const staleCount = mapAnimals.filter((a) => a.stale).length;
  const outsideCount = mapAnimals.filter((a) => !a.stale && a.animal_status === 'breach').length;
  const headerSubtitle =
    mapAnimals.length === 0
      ? `${geofences.length} fence${geofences.length === 1 ? '' : 's'} · no collar positions yet`
      : [
          `${mapAnimals.length} animal${mapAnimals.length === 1 ? '' : 's'}`,
          outsideCount > 0 ? `${outsideCount} outside` : null,
          staleCount > 0 ? `${staleCount} without a recent fix` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const canLocate = Boolean(deviceLoc && checkMyPosition);
  const controlsHeight = mapControlsHeight({ locate: canLocate, appearance: !drawing, pickerOpen });

  const fenceItems = polygons.map((p) => {
    const raw = geofences.find((g) => g.id === p.id);
    return {
      id: p.id,
      name: p.name,
      pointCount: openRing(p.coords).length,
      isActive: raw?.is_active ?? true,
      bufferMeters: p.warningBufferMeters,
    };
  });

  return (
    <Screen
      mode="fixed"
      header={
        <AppHeader
          compact
          edge="overlay"
          title="Live map"
          subtitle={headerSubtitle}
          titleLines={1}
          right={
            <IconButton
              icon={legendOpen ? 'map-legend' : 'information-outline'}
              variant="onDark"
              selected={legendOpen}
              onPress={() => setLegendOpen((v) => !v)}
              accessibilityLabel={legendOpen ? 'Hide map legend' : 'Show map legend'}
            />
          }
        />
      }>
      <View style={styles.mapWrap}>
        <RanchMap
          ref={mapRef}
          mapType={mapType}
          deviceLocation={checkMyPosition ? deviceLoc : null}
          locations={mapAnimals}
          polygons={polygons}
          draftPoints={draftPoints}
          drawing={drawing}
          onPressCoordinate={onPressCoordinate}
          onDragVertex={onDragVertex}
          onDeleteVertex={onDeleteVertex}
          onMarkerPress={(id) => router.push({ pathname: '/livestock/[id]', params: { id } })}
          onFencePress={onFencePress}
          onMapPress={() => setPickerOpen(false)}
        />

        {/* Every floating element lives in this one column, so no two can
            ever take the same space. Top row: status chip (+ legend) beside
            the controls; it never gets shorter than the controls. Bottom:
            toast, credit line and the sheet, whose list scrolls when space
            runs short while its header stays visible. */}
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.topRow, { minHeight: controlsHeight }]} pointerEvents="box-none">
            <View style={styles.topLeft} pointerEvents="box-none">
              <PositionChip state={probe} on={checkMyPosition} onToggle={togglePositionCheck} />
              {legendOpen && !drawing ? (
                <ScrollView style={styles.legendScroll} bounces={false} showsVerticalScrollIndicator={false}>
                  <MapLegend />
                </ScrollView>
              ) : null}
            </View>
            <MapControls
              onZoomIn={() => mapRef.current?.zoomBy(1)}
              onZoomOut={() => mapRef.current?.zoomBy(-1)}
              onLocate={canLocate && deviceLoc ? () => mapRef.current?.fitToCoordinates([deviceLoc]) : undefined}
              mapType={mapType}
              onMapTypeChange={(next) => {
                setMapType(next);
                setPickerOpen(false);
              }}
              pickerOpen={pickerOpen}
              onTogglePicker={() => setPickerOpen((v) => !v)}
              showAppearance={!drawing}
            />
          </View>

          {undoCandidate && !drawing ? (
            <UndoFenceToast
              fenceName={undoCandidate.name}
              onUndo={undoLastSave}
              onDismiss={() => setUndoCandidate(null)}
            />
          ) : null}

          <View style={styles.credit} pointerEvents="none">
            <Text variant="caption" color="secondary" numberOfLines={1} style={styles.creditText} maxFontSizeMultiplier={1}>
              {mapAttribution(mapType)}
            </Text>
          </View>

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
            <FenceListPanel
              items={fenceItems}
              collapsed={fenceListCollapsed}
              onToggleCollapsed={() => setFenceListCollapsed((v) => !v)}
              onFocus={focusFence}
              onDelete={onDeleteFence}
              onCreate={openCreateModal}
              isAdmin={Boolean(isAdmin)}
            />
          )}
        </View>
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
        bufferMeters={fenceBuffer}
        onChangeBufferMeters={setFenceBuffer}
        bufferValid={bufferValid}
        isActive={fenceActive}
        onChangeActive={setFenceActive}
        saving={saving}
        onCancel={() => setShowSaveConfirm(false)}
        onConfirm={confirmSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Tucked under the header's hills edge, which is drawn over the map.
  mapWrap: { flex: 1, overflow: 'hidden', marginTop: -Layout.hillsHeightCompact },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    paddingTop: Layout.hillsHeightCompact + Spacing.sm,
  },
  topRow: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  topLeft: { flex: 1, minWidth: 0, maxHeight: '100%', gap: Spacing.sm, alignItems: 'flex-start' },
  legendScroll: { flexGrow: 0, flexShrink: 1, alignSelf: 'stretch', overflow: 'visible' },
  credit: {
    alignSelf: 'flex-end',
    maxWidth: '100%',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: MapPalette.attributionBg,
  },
  creditText: { fontSize: 10, lineHeight: 14 },
});
