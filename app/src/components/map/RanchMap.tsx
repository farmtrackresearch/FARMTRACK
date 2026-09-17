import { Camera, GeoJSONSource, Layer, Map, Marker, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef, MapRef, ViewState } from '@maplibre/maplibre-react-native';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { MapLegend } from '@/components/map/MapLegend';
import type { RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { Colors, RANCH_REGION, Radius, Shadows, Spacing, Typography } from '@/constants/theme';
import {
  MAP_ATTRIBUTION,
  MAP_FALLBACK_MAX_ZOOM,
  MAP_KEY_CONFIGURED,
  MAP_MAX_ZOOM,
  MAP_STYLE,
} from '@/lib/mapStyle';
import { statusMarkerColor } from '@/lib/utils';
import type { MapLatLng } from '@/types/database';

const DRAFT_STROKE = '#6FCFEE';
const DRAFT_FILL = 'rgba(111,207,238,0.25)';

const FENCE_HALO = '#FFFFFF';
const FENCE_STROKE = '#2E7D32';
const FENCE_FILL = 'rgba(46,125,50,0.22)';
const WARNING_STROKE = '#F57C00';

/** Web Mercator, used only to turn a drag gesture in pixels back into a coordinate. */
const clampLat = (lat: number) => Math.max(-85.0511, Math.min(85.0511, lat));
const lonToWorldX = (lon: number) => (lon + 180) / 360;
const latToWorldY = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360)) / (2 * Math.PI);
const worldXToLon = (x: number) => x * 360 - 180;
const worldYToLat = (y: number) =>
  (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);

const INITIAL_ZOOM = 13;
const MIN_ZOOM = 2;

const toLngLat = (c: MapLatLng): [number, number] => [c.longitude, c.latitude];

/** GeoJSON polygon rings must close; the app stores them open. */
function closedRing(coords: MapLatLng[]): [number, number][] {
  if (coords.length < 3) return [];
  const ring = coords.map(toLngLat);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (Math.abs(fx - lx) > 1e-9 || Math.abs(fy - ly) > 1e-9) ring.push([fx, fy]);
  return ring;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function RanchMapInner(
  {
    locations,
    polygons,
    draftPoints,
    drawing = false,
    onPressCoordinate,
    onDragVertex,
    onDeleteVertex,
    onMarkerPress,
    onFencePress,
  }: RanchMapProps,
  ref: React.ForwardedRef<RanchMapHandle>
) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [fallbackNoticeSeen, setFallbackNoticeSeen] = useState(false);
  // Commanded zoom, held until the camera settles. Without it, tapping + twice
  // quickly would compute both steps from the same stale settled value.
  const [pendingZoom, setPendingZoom] = useState<number | null>(null);

  // Tracked only when the camera *settles* (onRegionDidChange), never during a
  // pan — so this costs one render per gesture end, not one per frame. That is
  // enough for both uses: the camera is stationary while a vertex is dragged,
  // and getCenter() is read after the user has stopped moving the map.
  const [view, setView] = useState<ViewState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const trackView = useCallback((e: { nativeEvent: ViewState }) => {
    setView(e.nativeEvent);
    setPendingZoom(null);
  }, []);

  const currentZoom = pendingZoom ?? view?.zoom ?? INITIAL_ZOOM;

  const zoomBy = useCallback(
    (delta: number) => {
      const next = Math.min(MAP_MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom + delta));
      if (next === currentZoom) return;
      setPendingZoom(next);
      cameraRef.current?.zoomTo(next, { duration: 180 });
    },
    [currentZoom]
  );

  /** Screen-pixel delta from a coordinate -> new coordinate, at the current camera. */
  const offsetCoord = useCallback(
    (from: MapLatLng, dx: number, dy: number): MapLatLng | null => {
      if (!view || !size.width || !size.height) return null;
      const [west, south, east, north] = view.bounds;
      const worldPerPxX = (lonToWorldX(east) - lonToWorldX(west)) / size.width;
      const worldPerPxY = (latToWorldY(south) - latToWorldY(north)) / size.height;
      return {
        longitude: worldXToLon(lonToWorldX(from.longitude) + dx * worldPerPxX),
        latitude: worldYToLat(latToWorldY(from.latitude) + dy * worldPerPxY),
      };
    },
    [view, size.width, size.height]
  );

  const fitToCoordinates = useCallback<NonNullable<RanchMapHandle['fitToCoordinates']>>(
    (coords, opts) => {
      if (coords.length === 0) return;
      let west = 180, south = 90, east = -180, north = -90;
      for (const c of coords) {
        if (c.longitude < west) west = c.longitude;
        if (c.longitude > east) east = c.longitude;
        if (c.latitude < south) south = c.latitude;
        if (c.latitude > north) north = c.latitude;
      }
      const pad = opts?.edgePadding;
      cameraRef.current?.fitBounds([west, south, east, north], {
        padding: pad
          ? { top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left }
          : { top: 60, right: 60, bottom: 60, left: 60 },
        duration: opts?.animated === false ? 0 : 500,
      });
    },
    []
  );

  const getCenter = useCallback<RanchMapHandle['getCenter']>(
    () => (view ? { latitude: view.center[1], longitude: view.center[0] } : RANCH_REGION),
    [view]
  );

  useImperativeHandle(ref, () => ({ fitToCoordinates, getCenter }), [fitToCoordinates, getCenter]);

  // One GeoJSON per concern. Re-rendering pushes new data to an existing GPU
  // layer instead of mounting a native view per fence, per pass.
  const fenceFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: polygons
        .map((p) => ({ p, ring: closedRing(p.coords) }))
        .filter(({ ring }) => ring.length >= 4)
        .map(({ p, ring }) => ({
          type: 'Feature' as const,
          id: p.id,
          properties: { id: p.id, name: p.name },
          geometry: { type: 'Polygon' as const, coordinates: [ring] },
        })),
    }),
    [polygons]
  );

  const stockFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: locations
        .filter((l) => l.latitude != null && l.longitude != null)
        .map((l) => ({
          type: 'Feature' as const,
          id: l.livestock_id,
          properties: {
            id: l.livestock_id,
            color: statusMarkerColor(l.animal_status),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [l.longitude as number, l.latitude as number],
          },
        })),
    }),
    [locations]
  );

  const draftOutline = useMemo(() => {
    if (draftPoints.length === 0) return [];
    const pts = draftPoints.map(toLngLat);
    return draftPoints.length >= 3 ? [...pts, pts[0]] : pts;
  }, [draftPoints]);

  const draftFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    if (draftPoints.length >= 3) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closedRing(draftPoints)] },
      });
    }
    if (draftOutline.length > 1) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: draftOutline },
      });
    }
    return features.length ? { type: 'FeatureCollection', features } : EMPTY_FC;
  }, [draftPoints, draftOutline]);

  const fenceCentres = useMemo(
    () =>
      polygons
        .filter((p) => p.coords.length >= 3)
        .map((p) => {
          let west = 180, south = 90, east = -180, north = -90;
          for (const c of p.coords) {
            if (c.longitude < west) west = c.longitude;
            if (c.longitude > east) east = c.longitude;
            if (c.latitude < south) south = c.latitude;
            if (c.latitude > north) north = c.latitude;
          }
          return {
            id: p.id,
            name: p.name,
            lngLat: [(west + east) / 2, (south + north) / 2] as [number, number],
          };
        }),
    [polygons]
  );

  const handleMapPress = useCallback(
    (e: { nativeEvent: { lngLat?: [number, number] } }) => {
      const lngLat = e.nativeEvent.lngLat;
      if (!drawing || !lngLat) return;
      onPressCoordinate({ longitude: lngLat[0], latitude: lngLat[1] });
    },
    [drawing, onPressCoordinate]
  );

  const makeVertexResponder = (point: MapLatLng, index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => drawing,
      onMoveShouldSetPanResponder: () => drawing,
      onPanResponderMove: (_e, gesture) => {
        if (!onDragVertex) return;
        const next = offsetCoord(point, gesture.dx, gesture.dy);
        if (next) onDragVertex(index, next);
      },
      onPanResponderRelease: (_e, gesture) => {
        // A press that never moved is a delete, matching the old behaviour.
        if (Math.abs(gesture.dx) < 4 && Math.abs(gesture.dy) < 4) {
          if (draftPoints.length > 3) onDeleteVertex?.(index);
          return;
        }
        const next = offsetCoord(point, gesture.dx, gesture.dy);
        if (next) onDragVertex?.(index, next);
      },
    });

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        onPress={handleMapPress}
        onLongPress={handleMapPress}
        onRegionDidChange={trackView}
        attribution={false}
        logo={false}
        compass={false}>
        <Camera
          ref={cameraRef}
          maxZoom={MAP_MAX_ZOOM}
          initialViewState={{
            center: [RANCH_REGION.longitude, RANCH_REGION.latitude],
            zoom: 13,
          }}
        />
        <UserLocation />

        <GeoJSONSource
          id="fences"
          data={fenceFC}
          onPress={(e) => {
            if (drawing) return;
            const f = e.nativeEvent.features?.[0];
            const props = f?.properties as { id?: string; name?: string } | undefined;
            if (props?.id) onFencePress(props.id, props.name ?? 'Fence');
          }}>
          <Layer
            id="fence-warning"
            type="line"
            paint={{
              'line-color': WARNING_STROKE,
              'line-width': 3,
              'line-dasharray': [4, 3],
              'line-opacity': 0.9,
              'line-offset': 6,
            }}
          />
          <Layer id="fence-fill" type="fill" paint={{ 'fill-color': FENCE_FILL }} />
          <Layer
            id="fence-halo"
            type="line"
            paint={{ 'line-color': FENCE_HALO, 'line-width': 7 }}
          />
          <Layer
            id="fence-line"
            type="line"
            paint={{ 'line-color': FENCE_STROKE, 'line-width': 4 }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="draft" data={draftFC}>
          <Layer id="draft-fill" type="fill" paint={{ 'fill-color': DRAFT_FILL }} />
          <Layer
            id="draft-line"
            type="line"
            paint={{ 'line-color': DRAFT_STROKE, 'line-width': 3, 'line-dasharray': [3, 2] }}
          />
        </GeoJSONSource>

        <GeoJSONSource
          id="stock"
          data={stockFC}
          onPress={(e) => {
            if (drawing) return;
            const props = e.nativeEvent.features?.[0]?.properties as { id?: string } | undefined;
            if (props?.id) onMarkerPress(props.id);
          }}>
          <Layer
            id="stock-dot"
            type="circle"
            paint={{
              'circle-radius': 9,
              'circle-color': ['get', 'color'],
              'circle-stroke-color': '#FFFFFF',
              'circle-stroke-width': 3,
            }}
          />
        </GeoJSONSource>

        {fenceCentres.map((f) => (
          <Marker key={`label-${f.id}`} id={`label-${f.id}`} lngLat={f.lngLat}>
            <View style={styles.fenceLabel} pointerEvents="none">
              <Text style={styles.fenceLabelText} numberOfLines={1}>
                {f.name}
              </Text>
            </View>
          </Marker>
        ))}

        {drawing
          ? draftPoints.map((point, index) => (
              <Marker key={`vertex-${index}`} id={`vertex-${index}`} lngLat={toLngLat(point)}>
                <View style={styles.vertex} {...makeVertexResponder(point, index).panHandlers}>
                  <View style={styles.vertexInner} />
                </View>
              </Marker>
            ))
          : null}

      </Map>

      <View style={styles.zoomControl}>
        <Pressable
          onPress={() => zoomBy(1)}
          disabled={currentZoom >= MAP_MAX_ZOOM}
          style={({ pressed }) => [
            styles.zoomBtn,
            pressed && styles.zoomBtnPressed,
            currentZoom >= MAP_MAX_ZOOM && styles.zoomBtnDisabled,
          ]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Zoom in">
          <MaterialCommunityIcons
            name="plus"
            size={22}
            color={currentZoom >= MAP_MAX_ZOOM ? Colors.textMuted : Colors.primaryDark}
          />
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable
          onPress={() => zoomBy(-1)}
          disabled={currentZoom <= MIN_ZOOM}
          style={({ pressed }) => [
            styles.zoomBtn,
            pressed && styles.zoomBtnPressed,
            currentZoom <= MIN_ZOOM && styles.zoomBtnDisabled,
          ]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Zoom out">
          <MaterialCommunityIcons
            name="minus"
            size={22}
            color={currentZoom <= MIN_ZOOM ? Colors.textMuted : Colors.primaryDark}
          />
        </Pressable>
      </View>

      {!MAP_KEY_CONFIGURED && !fallbackNoticeSeen ? (
        <View style={styles.noticeWrap}>
          <View style={styles.notice}>
            <MaterialCommunityIcons
              name="map-outline"
              size={20}
              color={Colors.warning}
              style={styles.noticeIcon}
            />
            <View style={styles.noticeBody}>
              <Text style={styles.noticeTitle}>Preview basemap</Text>
              <Text style={styles.noticeText}>
                Using OpenTopoMap as a fallback. Detail stops improving beyond zoom{' '}
                {MAP_FALLBACK_MAX_ZOOM}, which is coarse for placing fence corners. Add a MapTiler
                key for full-resolution mapping.
              </Text>
              {__DEV__ ? (
                <Text style={styles.noticeHint}>Set EXPO_PUBLIC_MAPTILER_KEY in app/.env</Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => setFallbackNoticeSeen(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Dismiss basemap notice">
              <MaterialCommunityIcons name="close" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>{MAP_ATTRIBUTION}</Text>
      </View>
      <MapLegend />
    </View>
  );
}

const RanchMap = forwardRef<RanchMapHandle, RanchMapProps>(RanchMapInner);
RanchMap.displayName = 'RanchMap';
export default RanchMap;

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  attributionText: { fontSize: 9, color: '#333' },
  zoomControl: {
    position: 'absolute',
    right: Spacing.md,
    top: '50%',
    marginTop: -44,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.card,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnPressed: { backgroundColor: Colors.surfaceVariant },
  zoomBtnDisabled: { opacity: 0.45 },
  zoomDivider: { height: 1, backgroundColor: Colors.border },
  noticeWrap: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    right: Spacing.md,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.warning,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Shadows.card,
  },
  noticeIcon: { marginTop: 1 },
  noticeBody: { flex: 1, gap: 2 },
  noticeTitle: { ...Typography.label, color: Colors.primaryDark },
  noticeText: { ...Typography.caption, color: Colors.textSecondary },
  noticeHint: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  vertex: {
    // 44x44 hit area — accessible-minimum touch target for shaky hands outdoors.
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vertexInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: DRAFT_STROKE,
    ...Shadows.soft,
  },
  fenceLabel: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: FENCE_STROKE,
    maxWidth: 140,
    alignItems: 'center',
    ...Shadows.card,
  },
  fenceLabelText: {
    fontSize: 12,
    fontWeight: '900',
    color: FENCE_STROKE,
    letterSpacing: 0.3,
  },
});
