import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, {
  Marker,
  Polygon,
  Polyline,
  PROVIDER_DEFAULT,
  UrlTile,
  LatLng,
} from 'react-native-maps';

import { MapLegend } from '@/components/map/MapLegend';
import type { RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { Colors, RANCH_REGION, Shadows } from '@/constants/theme';
import type { MapLatLng } from '@/types/database';
import { statusMarkerColor } from '@/lib/utils';
import {
  OSM_ATTRIBUTION_LABEL,
  OSM_MAX_ZOOM,
  OSM_TILE_URL_TEMPLATE,
} from '@/lib/osmTiles';

const DRAFT_STROKE = '#6FCFEE';
const DRAFT_FILL = 'rgba(111,207,238,0.25)';
const GHOST_STROKE = 'rgba(111,207,238,0.7)';

const FENCE_HALO = '#FFFFFF';
const FENCE_HALO_WIDTH = 7;
const FENCE_STROKE = '#2E7D32';
const FENCE_STROKE_WIDTH = 4;
const FENCE_FILL = 'rgba(46,125,50,0.22)';

const WARNING_HALO = 'rgba(255,152,0,0.35)';
const WARNING_HALO_WIDTH = 14;
const WARNING_STROKE = '#F57C00';
const WARNING_STROKE_WIDTH = 3;

function cleanPolygonCoords(coords: MapLatLng[]): MapLatLng[] {
  if (coords.length < 2) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  const same =
    Math.abs(first.latitude - last.latitude) < 1e-7 &&
    Math.abs(first.longitude - last.longitude) < 1e-7;
  return same ? coords.slice(0, -1) : coords;
}

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
  const mapRef = useRef<MapView>(null);
  const [cursorPoint, setCursorPoint] = useState<MapLatLng | null>(null);
  const currentRegionRef = useRef<MapLatLng>(RANCH_REGION);

  const fitToCoordinates = useCallback<NonNullable<RanchMapHandle['fitToCoordinates']>>(
    (coords, opts) => {
      if (!mapRef.current || coords.length === 0) return;
      const padding = opts?.edgePadding ?? { top: 60, right: 60, bottom: 140, left: 60 };
      const animated = opts?.animated ?? true;
      if (coords.length === 1) {
        const c = coords[0];
        mapRef.current.animateToRegion(
          {
            latitude: c.latitude,
            longitude: c.longitude,
            latitudeDelta: RANCH_REGION.latitudeDelta,
            longitudeDelta: RANCH_REGION.longitudeDelta,
          },
          animated ? 500 : 0
        );
        return;
      }
      try {
        mapRef.current.fitToCoordinates(coords as LatLng[], {
          edgePadding: padding,
          animated,
        });
      } catch (err) {
        console.warn('[RanchMap] fitToCoordinates failed:', err);
      }
    },
    []
  );

  const getCenter = useCallback<RanchMapHandle['getCenter']>(
    () => currentRegionRef.current,
    []
  );

  useImperativeHandle(ref, () => ({ fitToCoordinates, getCenter }), [fitToCoordinates, getCenter]);

  const outlineCoords = useMemo(() => {
    if (draftPoints.length === 0) return [];
    if (draftPoints.length === 1) {
      return cursorPoint ? [draftPoints[0], cursorPoint] : draftPoints;
    }
    if (draftPoints.length >= 3) {
      return cursorPoint
        ? [...draftPoints, cursorPoint, draftPoints[0]]
        : [...draftPoints, draftPoints[0]];
    }
    return cursorPoint ? [...draftPoints, cursorPoint] : draftPoints;
  }, [draftPoints, cursorPoint]);

  const initialRegion = useMemo(() => {
    if (polygons.length === 0) return RANCH_REGION;
    const all = polygons.flatMap((p) => p.coords);
    if (all.length === 0) return RANCH_REGION;
    const lats = all.map((c) => c.latitude);
    const lngs = all.map((c) => c.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padLat = Math.max(0.002, (maxLat - minLat) * 0.3);
    const padLng = Math.max(0.002, (maxLng - minLng) * 0.3);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: maxLat - minLat + padLat * 2,
      longitudeDelta: maxLng - minLng + padLng * 2,
    };
  }, [polygons.length === 0]);

  useEffect(() => {
    currentRegionRef.current = { latitude: initialRegion.latitude, longitude: initialRegion.longitude };
  }, [initialRegion]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        // PROVIDER_DEFAULT + mapType="none" suppress the native Apple/Google
        // base layer entirely, leaving the OSM UrlTile below as the only
        // imagery. Keep both as literal JSX props — wiring either to state is
        // what would let a Google/Apple frame flash through.
        provider={PROVIDER_DEFAULT}
        mapType="none"
        initialRegion={initialRegion}
        onPress={(e) => {
          if (!drawing) return;
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onPressCoordinate({ latitude, longitude });
        }}
        onLongPress={(e) => {
          if (!drawing) return;
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onPressCoordinate({ latitude, longitude });
        }}
        onPanDrag={(e) => {
          if (!drawing) return;
          if (e.nativeEvent.coordinate) {
            setCursorPoint({
              latitude: e.nativeEvent.coordinate.latitude,
              longitude: e.nativeEvent.coordinate.longitude,
            });
          }
        }}
        onRegionChangeComplete={(region) => {
          setCursorPoint(null);
          currentRegionRef.current = { latitude: region.latitude, longitude: region.longitude };
        }}
        showsUserLocation
        showsCompass={false}>
        <UrlTile
          urlTemplate={OSM_TILE_URL_TEMPLATE}
          maximumZ={OSM_MAX_ZOOM}
          flipY={false}
          shouldReplaceMapContent
        />
        {polygons.map((p) => {
          const coords = cleanPolygonCoords(p.coords);
          if (coords.length < 3) return null;
          return (
            <Polygon
              key={`warn-halo-${p.id}`}
              coordinates={coords}
              strokeColor={WARNING_HALO}
              strokeWidth={WARNING_HALO_WIDTH}
              fillColor="transparent"
              tappable={false}
            />
          );
        })}

        {polygons.map((p) => {
          const coords = cleanPolygonCoords(p.coords);
          if (coords.length < 3) return null;
          const closedForStroke = [...coords, coords[0]];
          return (
            <Polyline
              key={`warn-stroke-${p.id}`}
              coordinates={closedForStroke}
              strokeColor={WARNING_STROKE}
              strokeWidth={WARNING_STROKE_WIDTH}
              lineDashPattern={[8, 6]}
              tappable={false}
            />
          );
        })}

        {polygons.map((p) => {
          const coords = cleanPolygonCoords(p.coords);
          if (coords.length < 3) return null;
          return (
            <Polygon
              key={`halo-${p.id}`}
              coordinates={coords}
              strokeColor={FENCE_HALO}
              strokeWidth={FENCE_HALO_WIDTH}
              fillColor="transparent"
              tappable={false}
            />
          );
        })}

        {polygons.map((p) => {
          const coords = cleanPolygonCoords(p.coords);
          if (coords.length < 3) return null;
          const zonePressed = drawing ? undefined : () => onFencePress(p.id, p.name);
          return (
            <Polygon
              key={`fill-${p.id}`}
              coordinates={coords}
              strokeColor={FENCE_STROKE}
              strokeWidth={FENCE_STROKE_WIDTH}
              fillColor={drawing ? 'rgba(46,125,50,0.08)' : FENCE_FILL}
              tappable={!drawing}
              onPress={zonePressed}
            />
          );
        })}

        {polygons.map((p) => {
          if (!p.coords.length) return null;
          const coords = cleanPolygonCoords(p.coords);
          if (coords.length < 3) return null;
          const lats = coords.map((c) => c.latitude);
          const lngs = coords.map((c) => c.longitude);
          const center: MapLatLng = {
            latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
            longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          };
          return (
            <Marker
              key={`label-${p.id}`}
              coordinate={center}
              tappable={!drawing}
              onPress={drawing ? undefined : () => onFencePress(p.id, p.name)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.fenceLabel}>
                <Text style={styles.fenceLabelText} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>
            </Marker>
          );
        })}

        {outlineCoords.length > 1 ? (
          <Polyline
            coordinates={outlineCoords}
            strokeColor={cursorPoint && draftPoints.length >= 3 ? GHOST_STROKE : DRAFT_STROKE}
            strokeWidth={3}
            lineDashPattern={cursorPoint ? [6, 4] : undefined}
            tappable={false}
          />
        ) : null}

        {draftPoints.length >= 3 && Platform.OS === 'android' ? (
          <Polygon
            coordinates={draftPoints}
            strokeColor="transparent"
            fillColor={DRAFT_FILL}
            strokeWidth={0}
            tappable={false}
          />
        ) : null}

        {draftPoints.length >= 3 && Platform.OS !== 'android' ? (
          <Polygon
            coordinates={[...draftPoints, draftPoints[0]]}
            strokeColor="transparent"
            fillColor={DRAFT_FILL}
            strokeWidth={0}
            tappable={false}
          />
        ) : null}

        {cursorPoint && drawing ? (
          <Marker
            coordinate={cursorPoint}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            tappable={false}>
            <View style={styles.ghostVertex} />
          </Marker>
        ) : null}

        {drawing
          ? draftPoints.map((point, index) => (
              <Marker
                key={`draft-${index}`}
                coordinate={point}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges
                draggable
                onDrag={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  onDragVertex?.(index, { latitude, longitude });
                }}
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  onDragVertex?.(index, { latitude, longitude });
                }}
                onCalloutPress={() => onDeleteVertex?.(index)}
                onPress={() => {
                  if (draftPoints.length <= 3) return;
                  onDeleteVertex?.(index);
                }}>
                <View style={styles.vertex}>
                  <View style={styles.vertexInner} />
                </View>
              </Marker>
            ))
          : null}

        {locations.map((item) => {
          if (item.latitude == null || item.longitude == null) return null;
          const color = statusMarkerColor(item.animal_status);
          return (
            <Marker
              key={item.livestock_id}
              coordinate={{ latitude: item.latitude, longitude: item.longitude }}
              onPress={drawing ? undefined : () => onMarkerPress(item.livestock_id)}
              tracksViewChanges={false}
              tappable={!drawing}
              title={drawing ? undefined : item.name}
              description={
                drawing
                  ? undefined
                  : `${item.battery_level ?? '—'}% · ${item.animal_status.replace('_', ' ')}`
              }>
              <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
            </Marker>
          );
        })}
      </MapView>
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>{OSM_ATTRIBUTION_LABEL}</Text>
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
  ghostVertex: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: GHOST_STROKE,
    backgroundColor: 'rgba(255,255,255,0.6)',
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
