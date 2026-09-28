import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

import type { MapAppearance, RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { Colors, FontFamily, MapPalette, RANCH_REGION, Radius, Shadows } from '@/constants/theme';
import type { MapLatLng } from '@/types/database';
import { latLngsToRing, statusMarkerColor } from '@/lib/utils';

/**
 * Tile sources. Production imagery comes from MapTiler
 * (EXPO_PUBLIC_MAPTILER_KEY, free tier at https://cloud.maptiler.com).
 *
 * Without a key, development builds fall back to OpenTopoMap and Esri World
 * Imagery so the map is usable while coding. Neither may be used by a
 * published app (OpenTopoMap is volunteer-run; Esri imagery needs an ArcGIS
 * licence), so release builds without a key draw fences and animals on a
 * plain background and say why. Two other "free" servers were dead ends even
 * though they return HTTP 200: tile.openstreetmap.org blocks app traffic
 * (x-blocked header) and basemaps.cartocdn.com serves an "API KEY REQUIRED"
 * watermark image.
 */
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

type TileSource = { url: string; maxZoom: number; attribution: string };

// OpenTopoMap only renders up to z17; it doubles as the keyless Terrain map.
const OPENTOPO_DEV: TileSource = {
  url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
  maxZoom: 17,
  attribution: '© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors · development only',
};

const ESRI_DEV: TileSource = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: '© Esri, Maxar, Earthstar Geographics · development only',
};

// MapTiler raster XYZ: /maps/{mapId}/256/{z}/{x}/{y}.{format} matches tileSize 256.
const maptiler = (style: string, format: 'png' | 'jpg'): TileSource => ({
  url: `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.${format}?key=${MAPTILER_KEY}`,
  maxZoom: 19,
  attribution: '© MapTiler © OpenStreetMap contributors',
});

const devFallback = (source: TileSource): TileSource | null => (__DEV__ ? source : null);

const TILES: Record<MapAppearance, TileSource | null> = {
  standard: MAPTILER_KEY ? maptiler('streets-v2', 'png') : devFallback(OPENTOPO_DEV),
  satellite: MAPTILER_KEY ? maptiler('satellite', 'jpg') : devFallback(ESRI_DEV),
  terrain: MAPTILER_KEY ? maptiler('outdoor-v2', 'png') : devFallback(OPENTOPO_DEV),
};

const APPEARANCES: MapAppearance[] = ['standard', 'satellite', 'terrain'];

/** Tile credit for the current appearance. The map screen shows it above its bottom sheet. */
export function mapAttribution(mapType: MapAppearance): string {
  const tiles = TILES[mapType];
  return tiles ? tiles.attribution : 'Map imagery off: set EXPO_PUBLIC_MAPTILER_KEY for this build';
}

// Symbol layers (animal tag labels) need glyphs. The font must exist on the
// glyph server as a single fontstack: "Noto Sans Bold" is served by both.
const LABEL_FONT = ['Noto Sans Bold'];
const GLYPHS_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

// MapLibre requires a style up front. Keeping it a frozen module constant means
// the style never reloads — the standard/satellite toggle only flips layer
// visibility. The background layer is what prevents a white flash on first
// paint and while tiles stream in.
const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS_URL,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': MapPalette.background } }],
};

const DRAFT_STROKE = MapPalette.draftStroke;
const DRAFT_FILL = MapPalette.draftFill;

const FENCE_HALO = MapPalette.fenceHalo;
const FENCE_HALO_WIDTH = 7;
const FENCE_STROKE = MapPalette.fenceStroke;
const FENCE_STROKE_WIDTH = 4;
const FENCE_FILL = MapPalette.fenceFill;
const INACTIVE_FILL = MapPalette.inactiveFill;
const INACTIVE_STROKE = MapPalette.inactiveStroke;

const WARNING_HALO = MapPalette.warnHalo;
const WARNING_HALO_WIDTH = 14;
const WARNING_STROKE = MapPalette.warnStroke;
const WARNING_STROKE_WIDTH = 3;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const MIN_ZOOM = 2;
const MAX_ZOOM = 20;

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

function initialBoundsFor(coords: MapLatLng[]): LngLatBounds {
  if (coords.length === 0) {
    const dLat = RANCH_REGION.latitudeDelta / 2;
    const dLng = RANCH_REGION.longitudeDelta / 2;
    return [
      RANCH_REGION.longitude - dLng,
      RANCH_REGION.latitude - dLat,
      RANCH_REGION.longitude + dLng,
      RANCH_REGION.latitude + dLat,
    ];
  }
  const [w, s, e, n] = boundsOf(coords);
  const padLat = Math.max(0.002, (n - s) * 0.3);
  const padLng = Math.max(0.002, (e - w) * 0.3);
  return [w - padLng, s - padLat, e + padLng, n + padLat];
}

function RanchMapInner(
  {
    mapType,
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
    onMapPress,
  }: RanchMapProps,
  ref: React.ForwardedRef<RanchMapHandle>
) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  // The camera's initialViewState only applies at mount; map.tsx re-frames
  // once fences and animals have loaded.
  const [initialBounds] = useState(() => initialBoundsFor(polygons.flatMap((p) => p.coords)));
  const currentRegionRef = useRef<MapLatLng>({
    latitude: (initialBounds[1] + initialBounds[3]) / 2,
    longitude: (initialBounds[0] + initialBounds[2]) / 2,
  });
  const zoomRef = useRef<number | null>(null);
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

  useImperativeHandle(ref, () => ({ fitToCoordinates, getCenter, zoomBy }), [fitToCoordinates, getCenter, zoomBy]);

  const fenceFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = polygons
      .map((p) => ({ p, ring: latLngsToRing(p.coords) }))
      .filter(({ ring }) => ring.length >= 4)
      .map(({ p, ring }) => ({
        type: 'Feature' as const,
        id: p.id,
        properties: { fenceId: p.id, fenceName: p.name, active: p.isActive !== false },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      }));
    return { type: 'FeatureCollection', features };
  }, [polygons]);

  const fenceLabels = useMemo(
    () =>
      polygons
        .filter((p) => latLngsToRing(p.coords).length >= 4)
        .map((p) => ({ id: p.id, name: p.name, active: p.isActive !== false, center: centerOf(p.coords) })),
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

  const animalFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: locations
        .filter((l) => l.latitude != null && l.longitude != null)
        .map((l) => ({
          type: 'Feature' as const,
          id: l.livestock_id,
          properties: {
            livestockId: l.livestock_id,
            label: l.tag_id,
            color: statusMarkerColor(l.animal_status, l.stale),
            stale: l.stale,
            status: l.animal_status,
            urgent: !l.stale && (l.animal_status === 'breach' || l.animal_status === 'near_boundary'),
          },
          geometry: { type: 'Point' as const, coordinates: [l.longitude as number, l.latitude as number] },
        })),
    }),
    [locations]
  );

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
          onMapPress?.();
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
        {APPEARANCES.map((id) => {
          const source = TILES[id];
          if (!source) return null;
          return (
            <RasterSource
              key={id}
              id={`tiles-${id}`}
              tiles={[source.url]}
              tileSize={256}
              maxzoom={source.maxZoom}
              attribution={source.attribution}>
              <Layer
                id={`tiles-${id}-layer`}
                type="raster"
                layout={{ visibility: mapType === id ? 'visible' : 'none' }}
              />
            </RasterSource>
          );
        })}

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
            filter={['==', ['get', 'active'], true]}
            paint={{ 'line-color': WARNING_HALO, 'line-width': WARNING_HALO_WIDTH }}
          />
          <Layer
            id="fence-warn-dash"
            type="line"
            filter={['==', ['get', 'active'], true]}
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
            paint={{
              'fill-color': drawing
                ? MapPalette.fenceFillDrawing
                : ['case', ['get', 'active'], FENCE_FILL, INACTIVE_FILL],
            }}
          />
          <Layer
            id="fence-stroke"
            type="line"
            filter={['==', ['get', 'active'], true]}
            paint={{
              'line-color': FENCE_STROKE,
              'line-width': FENCE_STROKE_WIDTH,
            }}
          />
          {/* Switched-off fences: grey and dashed, so "off" never relies on colour alone. */}
          <Layer
            id="fence-stroke-off"
            type="line"
            afterId="fence-stroke"
            filter={['==', ['get', 'active'], false]}
            paint={{
              'line-color': INACTIVE_STROKE,
              'line-width': 3,
              'line-dasharray': [2, 1.5],
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="draft" data={draftFC}>
          <Layer id="draft-fill" type="fill" paint={{ 'fill-color': DRAFT_FILL }} />
          <Layer
            id="draft-halo"
            type="line"
            afterId="draft-fill"
            paint={{ 'line-color': MapPalette.draftHalo, 'line-width': 6 }}
          />
          <Layer
            id="draft-line"
            type="line"
            paint={{ 'line-color': DRAFT_STROKE, 'line-width': 3 }}
          />
        </GeoJSONSource>

        {/* Only while "check my position" is on, so the map never runs GPS on its own. */}
        {deviceLocation ? <UserLocation /> : null}

        {/* Animals as native layers: one source update per refresh instead of a
            React view per animal. Hollow grey ring = no fix for 3 minutes;
            a soft halo marks animals near or outside the fence. */}
        <GeoJSONSource
          id="animals"
          data={animalFC}
          onPress={
            drawing
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  const id = e.nativeEvent.features[0]?.properties?.livestockId;
                  if (typeof id === 'string') onMarkerPress(id);
                }
          }>
          <Layer
            id="animal-halo"
            type="circle"
            afterId="draft-line"
            filter={['==', ['get', 'urgent'], true]}
            paint={{
              'circle-radius': 17,
              'circle-color': ['get', 'color'],
              'circle-opacity': MapPalette.markerHaloOpacity,
            }}
          />
          <Layer
            id="animal-dot"
            type="circle"
            paint={{
              'circle-radius': 8,
              'circle-color': ['case', ['get', 'stale'], MapPalette.markerRing, ['get', 'color']],
              'circle-stroke-width': 3,
              'circle-stroke-color': ['case', ['get', 'stale'], ['get', 'color'], MapPalette.markerRing],
            }}
          />
          <Layer
            id="animal-label"
            type="symbol"
            layout={{
              // Words as well as colour: stale and outside-the-fence animals say so.
              'text-field': [
                'case',
                ['get', 'stale'],
                ['concat', ['get', 'label'], ' · no fix'],
                ['==', ['get', 'status'], 'breach'],
                ['concat', ['get', 'label'], ' · outside'],
                ['get', 'label'],
              ],
              'text-font': LABEL_FONT,
              'text-size': 12,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-optional': true,
            }}
            paint={{
              'text-color': MapPalette.labelText,
              'text-halo-color': MapPalette.labelHalo,
              'text-halo-width': 2,
            }}
          />
        </GeoJSONSource>

        {fenceLabels.map((f) => (
          <Marker
            key={`label-${f.id}`}
            lngLat={toLngLat(f.center)}
            anchor="center"
            onPress={drawing ? undefined : () => onFencePress(f.id, f.name)}>
            <View style={[styles.fenceLabel, !f.active && styles.fenceLabelOff]}>
              <Text style={[styles.fenceLabelText, !f.active && styles.fenceLabelTextOff]} numberOfLines={1}>
                {f.active ? f.name : `${f.name} · off`}
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

      </Map>
    </View>
  );
}

const RanchMap = forwardRef<RanchMapHandle, RanchMapProps>(RanchMapInner);
RanchMap.displayName = 'RanchMap';
export default RanchMap;

const styles = StyleSheet.create({
  wrap: { flex: 1 },
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
    backgroundColor: MapPalette.hitArea,
  },
  vertexInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 3,
    borderColor: DRAFT_STROKE,
    ...Shadows.raised,
  },
  fenceLabel: {
    maxWidth: 180,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: FENCE_STROKE,
  },
  fenceLabelOff: { borderColor: INACTIVE_STROKE, borderStyle: 'dashed' },
  fenceLabelText: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.primaryDark,
  },
  fenceLabelTextOff: { color: Colors.offlineInk },
});
