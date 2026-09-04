import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DimensionValue,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Line, Polygon as SvgPolygon, Polyline } from 'react-native-svg';

import { MapLegend } from '@/components/map/MapLegend';
import type { RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { Colors, RANCH_REGION, Shadows } from '@/constants/theme';
import { statusMarkerColor } from '@/lib/utils';
import type { MapLatLng } from '@/types/database';

type Size = { width: number; height: number };

const DRAFT_STROKE = '#6FCFEE';
const DRAFT_FILL = 'rgba(111,207,238,0.28)';
const GHOST_STROKE = 'rgba(111,207,238,0.7)';

const FENCE_HALO = '#FFFFFF';
const FENCE_HALO_WIDTH = 7;
const FENCE_STROKE = '#2E7D32';
const FENCE_STROKE_WIDTH = 4;
const FENCE_FILL = 'rgba(46,125,50,0.24)';

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

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

function computeBounds(coords: MapLatLng[]): Bounds | null {
  if (coords.length === 0) return null;
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

function computeRegion(bounds: Bounds, padRatio = 0.3) {
  const { minLat, maxLat, minLng, maxLng } = bounds;
  const padLat = Math.max(0.002, (maxLat - minLat) * padRatio);
  const padLng = Math.max(0.002, (maxLng - minLng) * padRatio);
  return {
    west: minLng - padLng,
    east: maxLng + padLng,
    south: minLat - padLat,
    north: maxLat + padLat,
  };
}

type Region = ReturnType<typeof computeRegion>;

function toPercent(coord: MapLatLng, r: Region) {
  const { west, north, east, south } = r;
  const width = east - west || 1;
  const height = north - south || 1;
  const x = ((coord.longitude - west) / width) * 100;
  const y = ((north - coord.latitude) / height) * 100;
  return {
    left: `${Math.max(0, Math.min(100, x))}%`,
    top: `${Math.max(0, Math.min(100, y))}%`,
  };
}

function fromPercent(xPct: number, yPct: number, r: Region): MapLatLng {
  const { west, north, east, south } = r;
  const width = east - west || 1;
  const height = north - south || 1;
  return {
    longitude: west + (xPct / 100) * width,
    latitude: north - (yPct / 100) * height,
  };
}

function toSvgXy(c: MapLatLng, size: Size, r: Region) {
  const { left, top } = toPercent(c, r);
  return {
    x: (parseFloat(left) / 100) * size.width,
    y: (parseFloat(top) / 100) * size.height,
  };
}

function toSvgPoints(coords: MapLatLng[], size: Size, r: Region) {
  if (!size.width || coords.length === 0) return '';
  return coords
    .map((c) => `${toSvgXy(c, size, r).x},${toSvgXy(c, size, r).y}`)
    .join(' ');
}

function RanchMapInner(
  {
    mapType,
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
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<MapLatLng | null>(null);
  const draggingIdx = useRef<number | null>(null);
  const userRegionRef = useRef<Region | null>(null);

  const polygonCoords = useMemo(
    () => polygons.flatMap((p) => p.coords),
    [polygons]
  );

  const region: Region = useMemo(() => {
    if (userRegionRef.current) return userRegionRef.current;
    const coords = polygonCoords.length > 0 ? polygonCoords : [];
    const b = computeBounds(coords);
    if (b) return computeRegion(b);
    const { latitude, longitude, latitudeDelta, longitudeDelta } = RANCH_REGION;
    return {
      west: longitude - longitudeDelta / 2,
      east: longitude + longitudeDelta / 2,
      south: latitude - latitudeDelta / 2,
      north: latitude + latitudeDelta / 2,
    };
  }, [polygonCoords]);

  const fitToCoordinates = useCallback<NonNullable<RanchMapHandle['fitToCoordinates']>>(
    (coords, opts) => {
      const b = computeBounds(coords);
      if (!b) return;
      const padding = opts?.edgePadding;
      const padRatio = padding
        ? 0.5
        : 0.3;
      userRegionRef.current = computeRegion(b, padRatio);
      setSize((s) => ({ ...s, width: s.width + 0.0001 }));
    },
    []
  );

  const getCenter = useCallback<RanchMapHandle['getCenter']>(
    () => ({
      latitude: (region.north + region.south) / 2,
      longitude: (region.west + region.east) / 2,
    }),
    [region]
  );

  useImperativeHandle(ref, () => ({ fitToCoordinates, getCenter }), [fitToCoordinates, getCenter]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const outlineCoords = useMemo(() => {
    if (draftPoints.length === 0) return [];
    if (draftPoints.length === 1) return cursor ? [draftPoints[0], cursor] : draftPoints;
    if (draftPoints.length >= 3) {
      return cursor ? [...draftPoints, cursor, draftPoints[0]] : [...draftPoints, draftPoints[0]];
    }
    return cursor ? [...draftPoints, cursor] : draftPoints;
  }, [draftPoints, cursor]);

  const draftOutlineSvg = useMemo(
    () => toSvgPoints(outlineCoords, size, region),
    [outlineCoords, size, region]
  );
  const draftFillSvg = useMemo(
    () => toSvgPoints(draftPoints, size, region),
    [draftPoints, size, region]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawing,
        onMoveShouldSetPanResponder: () => drawing,
        onPanResponderMove: (e) => {
          if (!size.width || !size.height) return;
          const { locationX, locationY } = e.nativeEvent;
          const coord = fromPercent(
            (locationX / size.width) * 100,
            (locationY / size.height) * 100,
            region
          );
          if (draggingIdx.current != null && onDragVertex) {
            onDragVertex(draggingIdx.current, coord);
          } else {
            setCursor(coord);
          }
        },
        onPanResponderRelease: (e) => {
          if (!size.width || !size.height) return;
          const { locationX, locationY } = e.nativeEvent;
          const coord = fromPercent(
            (locationX / size.width) * 100,
            (locationY / size.height) * 100,
            region
          );
          if (draggingIdx.current != null) {
            if (onDragVertex) onDragVertex(draggingIdx.current, coord);
            draggingIdx.current = null;
          }
          setCursor(null);
        },
      }),
    [drawing, size.width, size.height, onDragVertex, region]
  );

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View
        {...panResponder.panHandlers}
        style={[styles.canvas, mapType === 'satellite' ? styles.satellite : styles.standard]}
        onTouchStart={(e) => {
          if (!size.width || !size.height) return;
          const t = e.nativeEvent.touches[0];
          if (!t) return;
          const coord = fromPercent(
            ((t as unknown as { locationX: number }).locationX / size.width) * 100,
            ((t as unknown as { locationY: number }).locationY / size.height) * 100,
            region
          );
          setCursor(coord);
        }}
        onTouchEnd={() => setCursor(null)}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => {
            if (!drawing || !size.width || !size.height) return;
            const { locationX, locationY } = e.nativeEvent;
            onPressCoordinate(
              fromPercent((locationX / size.width) * 100, (locationY / size.height) * 100, region)
            );
          }}
          onLongPress={(e) => {
            if (!drawing || !size.width || !size.height) return;
            const { locationX, locationY } = e.nativeEvent;
            onPressCoordinate(
              fromPercent((locationX / size.width) * 100, (locationY / size.height) * 100, region)
            );
          }}>
          {size.width > 0 ? (
            <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
              {polygons.map((p) => {
                const coords = cleanPolygonCoords(p.coords);
                if (coords.length < 3) return null;
                const pts = toSvgPoints(coords, size, region);
                if (!pts) return null;
                return (
                  <SvgPolygon
                    key={`warn-halo-${p.id}`}
                    points={pts}
                    fill="transparent"
                    stroke={WARNING_HALO}
                    strokeWidth={WARNING_HALO_WIDTH}
                  />
                );
              })}

              {polygons.map((p) => {
                const coords = cleanPolygonCoords(p.coords);
                if (coords.length < 3) return null;
                const closed = [...coords, coords[0]];
                const pts = toSvgPoints(closed, size, region);
                if (!pts) return null;
                return (
                  <Polyline
                    key={`warn-stroke-${p.id}`}
                    points={pts}
                    stroke={WARNING_STROKE}
                    strokeWidth={WARNING_STROKE_WIDTH}
                    strokeDasharray="8 6"
                    fill="none"
                  />
                );
              })}

              {polygons.map((p) => {
                const coords = cleanPolygonCoords(p.coords);
                if (coords.length < 3) return null;
                const pts = toSvgPoints(coords, size, region);
                if (!pts) return null;
                return (
                  <SvgPolygon
                    key={`halo-${p.id}`}
                    points={pts}
                    fill="transparent"
                    stroke={FENCE_HALO}
                    strokeWidth={FENCE_HALO_WIDTH}
                  />
                );
              })}

              {polygons.map((p) => {
                const coords = cleanPolygonCoords(p.coords);
                if (coords.length < 3) return null;
                const pts = toSvgPoints(coords, size, region);
                if (!pts) return null;
                return (
                  <SvgPolygon
                    key={`fill-${p.id}`}
                    points={pts}
                    fill={drawing ? 'rgba(46,125,50,0.08)' : FENCE_FILL}
                    stroke={FENCE_STROKE}
                    strokeWidth={FENCE_STROKE_WIDTH}
                    onPress={drawing ? undefined : () => onFencePress(p.id, p.name)}
                  />
                );
              })}
              {draftOutlineSvg && draftPoints.length < 3 ? (
                <Polyline
                  points={draftOutlineSvg}
                  stroke={cursor ? GHOST_STROKE : DRAFT_STROKE}
                  strokeWidth={3}
                  strokeDasharray={cursor ? '6 4' : undefined}
                  fill="none"
                />
              ) : null}
              {draftOutlineSvg && draftPoints.length >= 3 ? (
                <>
                  <SvgPolygon points={draftFillSvg} fill={DRAFT_FILL} stroke="transparent" />
                  <Polyline
                    points={draftOutlineSvg}
                    stroke={cursor ? GHOST_STROKE : DRAFT_STROKE}
                    strokeWidth={3}
                    strokeDasharray={cursor ? '6 4' : undefined}
                    fill="none"
                  />
                </>
              ) : null}
              {cursor && draftPoints.length > 0 ? (
                <Line
                  x1={toSvgXy(draftPoints[draftPoints.length - 1], size, region).x}
                  y1={toSvgXy(draftPoints[draftPoints.length - 1], size, region).y}
                  x2={toSvgXy(cursor, size, region).x}
                  y2={toSvgXy(cursor, size, region).y}
                  stroke={GHOST_STROKE}
                  strokeWidth={3}
                  strokeDasharray="6 4"
                />
              ) : null}
            </Svg>
          ) : null}
        </Pressable>

        {polygons.map((p) => {
          const coords = cleanPolygonCoords(p.coords);
          if (coords.length < 3) return null;
          const b = computeBounds(coords)!;
          const center: MapLatLng = {
            latitude: (b.minLat + b.maxLat) / 2,
            longitude: (b.minLng + b.maxLng) / 2,
          };
          const pos = toPercent(center, region);
          return (
            <Pressable
              key={`label-${p.id}`}
              pointerEvents={drawing ? 'none' : 'auto'}
              onPress={drawing ? undefined : () => onFencePress(p.id, p.name)}
              style={[
                styles.fenceLabel,
                { left: pos.left as DimensionValue, top: pos.top as DimensionValue },
              ]}>
              <Text style={styles.fenceLabelText} numberOfLines={1}>
                {p.name}
              </Text>
            </Pressable>
          );
        })}

        {cursor && drawing ? (
          <View
            style={[
              styles.ghostVertex,
              {
                left: toPercent(cursor, region).left as DimensionValue,
                top: toPercent(cursor, region).top as DimensionValue,
              },
            ]}
            pointerEvents="none"
          />
        ) : null}

        {drawing
          ? draftPoints.map((point, index) => {
              const pos = toPercent(point, region);
              return (
                <Pressable
                  key={`draft-${index}`}
                  onLongPress={() => {
                    if (draftPoints.length <= 3) return;
                    onDeleteVertex?.(index);
                  }}
                  onPressIn={() => {
                    draggingIdx.current = index;
                  }}
                  onPressOut={() => {
                    draggingIdx.current = null;
                  }}
                  style={[
                    styles.vertex,
                    { left: pos.left as DimensionValue, top: pos.top as DimensionValue },
                  ]}>
                  <View style={styles.vertexInner} />
                </Pressable>
              );
            })
          : null}

        {locations.map((item) => {
          if (item.latitude == null || item.longitude == null) return null;
          const pos = toPercent({ latitude: item.latitude, longitude: item.longitude }, region);
          const color = statusMarkerColor(item.animal_status);
          return (
            <Pressable
              key={item.livestock_id}
              onPress={() => !drawing && onMarkerPress(item.livestock_id)}
              style={[
                styles.marker,
                { left: pos.left as DimensionValue, top: pos.top as DimensionValue },
                { backgroundColor: color, shadowColor: color },
                drawing && styles.markerDisabled,
              ]}>
              <Text style={styles.markerLabel}>{item.tag_id}</Text>
            </Pressable>
          );
        })}

        <View style={styles.webBadge} pointerEvents="none">
          <Text style={styles.webBadgeText}>
            Web preview map · Use iOS/Android for full satellite GIS
          </Text>
        </View>
      </View>

      <MapLegend />
    </View>
  );
}

const RanchMap = forwardRef<RanchMapHandle, RanchMapProps>(RanchMapInner);
RanchMap.displayName = 'RanchMap';
export default RanchMap;

const styles = StyleSheet.create({
  wrap: { flex: 1, position: 'relative' },
  canvas: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  satellite: {
    backgroundColor: '#3d4a2e',
  },
  standard: {
    backgroundColor: '#dce8d4',
  },
  marker: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    ...Shadows.soft,
  },
  markerDisabled: {
    opacity: 0.6,
  },
  markerLabel: {
    fontSize: 7,
    fontWeight: '800',
    color: '#fff',
  },
  vertex: {
    position: 'absolute',
    // 44x44 hit area — accessible-minimum touch target for shaky hands outdoors.
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
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
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: GHOST_STROKE,
    backgroundColor: 'rgba(255,255,255,0.6)',
    zIndex: 3,
  },
  fenceLabel: {
    position: 'absolute',
    marginLeft: -55,
    marginTop: -12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: FENCE_STROKE,
    width: 110,
    alignItems: 'center',
    zIndex: 3,
    ...Shadows.card,
  },
  fenceLabelText: {
    fontSize: 12,
    fontWeight: '900',
    color: FENCE_STROKE,
    letterSpacing: 0.3,
  },
  webBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 3,
  },
  webBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
