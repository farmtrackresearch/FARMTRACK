import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  GeoJSONSource,
  Layer,
  LngLat,
  LngLatBounds,
  Map,
  Marker,
  RasterSource,
  UserLocation,
  ViewAnnotation,
  type CameraRef,
  type MapRef,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';

import { MapLegend } from '@/components/map/MapLegend';
import type { MapAppearance, RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { Colors, RANCH_REGION, Shadows } from '@/constants/theme';
import type { MapLatLng } from '@/types/database';
import { latLngsToRing, statusMarkerColor } from '@/lib/utils';

/**
 * Two public raster sources turned out to be dead ends despite returning
 * HTTP 200: `tile.openstreetmap.org` sends an `x-blocked` header rejecting
 * app traffic (https://operations.osmfoundation.org/policies/tiles/), and
 * `basemaps.cartocdn.com` now serves a baked-in "API KEY REQUIRED" watermark
 * image instead of a real tile — a 200 status doesn't mean a usable tile,
 * always check the actual pixels. OpenTopoMap is a verified-working,
 * no-signup fallback for dev. Set EXPO_PUBLIC_MAPTILER_KEY (free tier, no
 * card required: https://cloud.maptiler.com) before shipping to production —
 * OpenTopoMap is volunteer-run and not meant for deployed-app traffic either.
 */
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

type TileSource = { url: string; maxZoom: number; attribution: string };

// OpenTopoMap only renders tiles up to z17 (higher requests return a "max zoom
// layer = 17" placeholder image); MapTiler's styles go to 19+. It is itself a
// topographic map, so it doubles as the keyless fallback for Terrain.
const OPENTOPO: TileSource = {
  url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
  maxZoom: 17,
  attribution: '© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors',
};

const maptiler = (style: string): TileSource => ({
  url: `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
  maxZoom: 19,
  attribution: '© MapTiler © OpenStreetMap contributors',
});

const TILES: Record<MapAppearance, TileSource> = {
  standard: MAPTILER_KEY ? maptiler('streets-v2') : OPENTOPO,
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  },
  terrain: MAPTILER_KEY ? maptiler('outdoor-v2') : OPENTOPO,
};

// Order is the order they appear in the picker — Standard first.
const APPEARANCES: { id: MapAppearance; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'terrain', label: 'Terrain' },
];

// MapLibre requires a style up front. Keeping it a frozen module constant means
// the style never reloads — the standard/satellite toggle only flips layer
// visibility. The background layer is what prevents a white flash on first
// paint and while tiles stream in.
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E8E4DC' } }],
};

const DRAFT_STROKE = '#6FCFEE';
const DRAFT_FILL = 'rgba(111,207,238,0.25)';

const FENCE_HALO = '#FFFFFF';
const FENCE_HALO_WIDTH = 7;
const FENCE_STROKE = '#2E7D32';
const FENCE_STROKE_WIDTH = 4;
const FENCE_FILL = 'rgba(46,125,50,0.22)';

const WARNING_HALO = 'rgba(255,152,0,0.35)';
const WARNING_HALO_WIDTH = 14;
const WARNING_STROKE = '#F57C00';
const WARNING_STROKE_WIDTH = 3;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const MIN_ZOOM = 2;
const MAX_ZOOM = 20;
const ZOOM_STEP = 1;

const toLngLat = (c: MapLatLng): LngLat => [c.longitude, c.latitude];
const toLatLng = (ll: LngLat): MapLatLng => ({ longitude: ll[0], latitude: ll[1] });

function boundsOf(coords: MapLatLng[]): LngLatBounds {
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function centerOf(coords: MapLatLng[]): MapLatLng {
  const [w, s, e, n] = boundsOf(coords);
  return { latitude: (s + n) / 2, longitude: (w + e) / 2 };
}

function RanchMapInner(
  {
    mapType,
    onMapTypeChange,
    deviceLocation,
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
  const currentRegionRef = useRef<MapLatLng>(RANCH_REGION);
  const zoomRef = useRef<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A drag also emits a press on some platforms; this suppresses the
  // tap-to-delete that would otherwise fire at the end of every vertex drag.
  const draggingRef = useRef(false);

  const fitToCoordinates = useCallback<NonNullable<RanchMapHandle['fitToCoordinates']>>(
    (coords, opts) => {
      if (!cameraRef.current || coords.length === 0) return;
      const padding = opts?.edgePadding ?? { top: 60, right: 60, bottom: 140, left: 60 };
      const duration = (opts?.animated ?? true) ? 500 : 0;
      let [w, s, e, n] = boundsOf(coords);
      if (coords.length === 1) {
        // Frame a single point at the ranch's default span rather than picking
        // an arbitrary zoom level.
        const dLat = RANCH_REGION.latitudeDelta / 2;
        const dLng = RANCH_REGION.longitudeDelta / 2;
        [w, s, e, n] = [w - dLng, s - dLat, e + dLng, n + dLat];
      }
      cameraRef.current.fitBounds([w, s, e, n], { padding, duration });
    },
    []
  );

  const getCenter = useCallback<RanchMapHandle['getCenter']>(
    () => currentRegionRef.current,
    []
  );

  const zoomBy = useCallback((delta: number) => {
    if (!cameraRef.current) return;
    const apply = (from: number) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from + delta));
      // Written before the animation settles so rapid taps stack instead of
      // each one reading the same pre-animation zoom.
      zoomRef.current = next;
      cameraRef.current?.zoomTo(next, { duration: 220 });
    };
    const known = zoomRef.current;
    if (known != null) {
      apply(known);
      return;
    }
    void mapRef.current?.getZoom().then(apply).catch(() => {});
  }, []);

  useImperativeHandle(ref, () => ({ fitToCoordinates, getCenter }), [fitToCoordinates, getCenter]);

  const fenceFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = polygons
      .map((p) => ({ p, ring: latLngsToRing(p.coords) }))
      .filter(({ ring }) => ring.length >= 4)
      .map(({ p, ring }) => ({
        type: 'Feature' as const,
        id: p.id,
        properties: { fenceId: p.id, fenceName: p.name },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      }));
    return { type: 'FeatureCollection', features };
  }, [polygons]);

  const fenceLabels = useMemo(
    () =>
      polygons
        .filter((p) => latLngsToRing(p.coords).length >= 4)
        .map((p) => ({ id: p.id, name: p.name, center: centerOf(p.coords) })),
    [polygons]
  );

  const draftFC = useMemo<GeoJSON.FeatureCollection>(() => {
    if (draftPoints.length < 2) return EMPTY_FC;
    const line = draftPoints.map(toLngLat);
    if (draftPoints.length >= 3) line.push(toLngLat(draftPoints[0]));
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } },
    ];
    if (draftPoints.length >= 3) {
      features.unshift({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [latLngsToRing(draftPoints)] },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [draftPoints]);

  const initialBounds = useMemo<LngLatBounds>(() => {
    const all = polygons.flatMap((p) => p.coords);
    if (all.length === 0) {
      const dLat = RANCH_REGION.latitudeDelta / 2;
      const dLng = RANCH_REGION.longitudeDelta / 2;
      return [
        RANCH_REGION.longitude - dLng,
        RANCH_REGION.latitude - dLat,
        RANCH_REGION.longitude + dLng,
        RANCH_REGION.latitude + dLat,
      ];
    }
    const [w, s, e, n] = boundsOf(all);
    const padLat = Math.max(0.002, (n - s) * 0.3);
    const padLng = Math.max(0.002, (e - w) * 0.3);
    return [w - padLng, s - padLat, e + padLng, n + padLat];
  }, [polygons.length === 0]);

  useEffect(() => {
    const [w, s, e, n] = initialBounds;
    currentRegionRef.current = { latitude: (s + n) / 2, longitude: (w + e) / 2 };
  }, [initialBounds]);

  return (
    <View style={styles.wrap}>
      <Map
        ref={mapRef}
        mapStyle={BASE_STYLE}
        style={StyleSheet.absoluteFill}
        // The app has always been north-up and flat; MapLibre enables rotate
        // and pitch by default, so both are switched back off here.
        touchRotate={false}
        touchPitch={false}
        attribution={false}
        logo={false}
        compass={false}
        scaleBar={false}
        onPress={(e) => {
          if (pickerOpen) setPickerOpen(false);
          if (!drawing) return;
          onPressCoordinate(toLatLng(e.nativeEvent.lngLat));
        }}
        onLongPress={(e) => {
          if (!drawing) return;
          onPressCoordinate(toLatLng(e.nativeEvent.lngLat));
        }}
        onRegionDidChange={(e) => {
          currentRegionRef.current = toLatLng(e.nativeEvent.center);
          zoomRef.current = e.nativeEvent.zoom;
        }}>
        <Camera ref={cameraRef} initialViewState={{ bounds: initialBounds }} />

        {/* All appearances stay mounted so switching only flips layer
            visibility — no style reload, no white flash, warm tile caches. */}
        {APPEARANCES.map(({ id }) => (
          <RasterSource
            key={id}
            id={`tiles-${id}`}
            tiles={[TILES[id].url]}
            tileSize={256}
            maxzoom={TILES[id].maxZoom}
            attribution={TILES[id].attribution}>
            <Layer
              id={`tiles-${id}-layer`}
              type="raster"
              layout={{ visibility: mapType === id ? 'visible' : 'none' }}
            />
          </RasterSource>
        ))}

        <GeoJSONSource
          id="fences"
          data={fenceFC}
          onPress={
            drawing
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  const props = e.nativeEvent.features[0]?.properties;
                  if (props) onFencePress(props.fenceId, props.fenceName);
                }
          }>
          <Layer
            id="fence-warn-halo"
            type="line"
            paint={{ 'line-color': WARNING_HALO, 'line-width': WARNING_HALO_WIDTH }}
          />
          <Layer
            id="fence-warn-dash"
            type="line"
            paint={{
              'line-color': WARNING_STROKE,
              'line-width': WARNING_STROKE_WIDTH,
              // Style-spec dash units are multiples of line width, not pixels.
              'line-dasharray': [8 / WARNING_STROKE_WIDTH, 6 / WARNING_STROKE_WIDTH],
            }}
          />
          <Layer
            id="fence-halo"
            type="line"
            paint={{ 'line-color': FENCE_HALO, 'line-width': FENCE_HALO_WIDTH }}
          />
          <Layer
            id="fence-fill"
            type="fill"
            paint={{ 'fill-color': drawing ? 'rgba(46,125,50,0.08)' : FENCE_FILL }}
          />
          <Layer
            id="fence-stroke"
            type="line"
            paint={{ 'line-color': FENCE_STROKE, 'line-width': FENCE_STROKE_WIDTH }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="draft" data={draftFC}>
          <Layer id="draft-fill" type="fill" paint={{ 'fill-color': DRAFT_FILL }} />
          <Layer
            id="draft-line"
            type="line"
            paint={{ 'line-color': DRAFT_STROKE, 'line-width': 3 }}
          />
        </GeoJSONSource>

        <UserLocation />

        {fenceLabels.map((f) => (
          <Marker
            key={`label-${f.id}`}
            lngLat={toLngLat(f.center)}
            anchor="center"
            onPress={drawing ? undefined : () => onFencePress(f.id, f.name)}>
            <View style={styles.fenceLabel}>
              <Text style={styles.fenceLabelText} numberOfLines={1}>
                {f.name}
              </Text>
            </View>
          </Marker>
        ))}

        {drawing
          ? draftPoints.map((point, index) => (
              <ViewAnnotation
                key={`draft-${index}`}
                id={`draft-${index}`}
                lngLat={toLngLat(point)}
                anchor="center"
                draggable
                onDragStart={() => {
                  draggingRef.current = true;
                }}
                onDrag={(e) => onDragVertex?.(index, toLatLng(e.nativeEvent.lngLat))}
                onDragEnd={(e) => {
                  onDragVertex?.(index, toLatLng(e.nativeEvent.lngLat));
                  draggingRef.current = false;
                }}
                onPress={() => {
                  if (draggingRef.current) return;
                  if (draftPoints.length <= 3) return;
                  onDeleteVertex?.(index);
                }}>
                <View style={styles.vertex}>
                  <View style={styles.vertexInner} />
                </View>
              </ViewAnnotation>
            ))
          : null}

        {locations.map((item) => {
          if (item.latitude == null || item.longitude == null) return null;
          const color = statusMarkerColor(item.animal_status);
          return (
            <Marker
              key={item.livestock_id}
              lngLat={[item.longitude, item.latitude]}
              anchor="center"
              onPress={drawing ? undefined : () => onMarkerPress(item.livestock_id)}>
              <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
            </Marker>
          );
        })}
      </Map>
      <View style={styles.controls}>
        <View style={styles.group}>
          <Pressable
            style={({ pressed }) => [styles.ctrlBtn, pressed && styles.ctrlBtnPressed]}
            onPress={() => zoomBy(ZOOM_STEP)}
            accessibilityRole="button"
            accessibilityLabel="Zoom in">
            <Ionicons name="add" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={({ pressed }) => [styles.ctrlBtn, pressed && styles.ctrlBtnPressed]}
            onPress={() => zoomBy(-ZOOM_STEP)}
            accessibilityRole="button"
            accessibilityLabel="Zoom out">
            <Ionicons name="remove" size={22} color={Colors.text} />
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.group, styles.ctrlBtn, pressed && styles.ctrlBtnPressed]}
          onPress={() => deviceLocation && fitToCoordinates([deviceLocation])}
          disabled={!deviceLocation}
          accessibilityRole="button"
          accessibilityLabel="Center on my location">
          <Ionicons
            name="navigate"
            size={20}
            color={deviceLocation ? Colors.primary : Colors.textSecondary}
          />
        </Pressable>

        {onMapTypeChange ? (
          pickerOpen ? (
            <View style={[styles.group, styles.picker]}>
              {APPEARANCES.map(({ id, label }) => {
                const active = id === mapType;
                return (
                  <Pressable
                    key={id}
                    style={({ pressed }) => [styles.pickerRow, pressed && styles.ctrlBtnPressed]}
                    onPress={() => {
                      onMapTypeChange(id);
                      setPickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${label} map`}>
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={16}
                      color={active ? Colors.primary : Colors.textSecondary}
                    />
                    <Text style={[styles.pickerLabel, active && styles.pickerLabelActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.group,
                styles.ctrlBtn,
                pressed && styles.ctrlBtnPressed,
              ]}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Change map appearance">
              <Ionicons name="layers-outline" size={20} color={Colors.text} />
            </Pressable>
          )
        ) : null}
      </View>
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>{TILES[mapType].attribution}</Text>
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
  controls: {
    position: 'absolute',
    right: 12,
    // Sits directly under MapLegend (top-right, ~158px of fixed content), which
    // keeps the greatest possible gap above the fence list and drawing panel
    // that occupy the bottom of the map.
    top: 172,
    // Right-aligned so the wider appearance picker grows leftward in place of
    // the layers button rather than pushing the column around.
    alignItems: 'flex-end',
    gap: 10,
    zIndex: 10,
  },
  group: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    ...Shadows.card,
  },
  ctrlBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnPressed: {
    backgroundColor: Colors.surfaceMuted,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  picker: {
    paddingVertical: 4,
    minWidth: 148,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 40,
  },
  pickerLabel: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500',
  },
  pickerLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  attributionText: {
    fontSize: 9,
    color: '#333',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#fff',
    ...Shadows.soft,
  },
  vertex: {
    // 44x44 hit area — accessible-minimum touch target for shaky hands outdoors.
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    // Android rasterizes ViewAnnotation children into a bitmap; a fully
    // transparent container can drop out of the hit test, so keep it barely
    // opaque.
    backgroundColor: 'rgba(0,0,0,0.01)',
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
    ...Shadows.card,
  },
  fenceLabelText: {
    fontSize: 12,
    fontWeight: '900',
    color: FENCE_STROKE,
    letterSpacing: 0.3,
  },
});
