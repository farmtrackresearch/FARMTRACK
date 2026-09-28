import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import {
  DimensionValue,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Line, Polygon as SvgPolygon, Polyline } from 'react-native-svg';

import type { MapAppearance, RanchMapHandle, RanchMapProps } from '@/components/map/RanchMap.types';
import { StatusMeta, statusKey } from '@/components/ui/tones';
import { Colors, FontFamily, MapPalette, RANCH_REGION, Radius, Shadows } from '@/constants/theme';
import type { MapLatLng } from '@/types/database';

type Size = { width: number; height: number };

const DRAFT_STROKE = MapPalette.draftStroke;
const DRAFT_FILL = MapPalette.draftFill;
const GHOST_STROKE = MapPalette.draftGhost;

const FENCE_HALO = MapPalette.fenceHalo;
const FENCE_HALO_WIDTH = 7;
const FENCE_STROKE = MapPalette.fenceStroke;
const FENCE_STROKE_WIDTH = 4;
const FENCE_FILL = MapPalette.fenceFill;

const WARNING_HALO = MapPalette.warnHalo;
const WARNING_HALO_WIDTH = 14;
const WARNING_STROKE = MapPalette.warnStroke;
const WARNING_STROKE_WIDTH = 3;

/** Tile credit shown by the map screen. The web build has no map imagery. */
export function mapAttribution(_mapType: MapAppearance): string {
  return 'Web preview map · open the app on a phone for map imagery';
}

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

// Not clamped: a point outside the region is drawn off-canvas rather than
// pinned to the edge, where an escaped animal would look like it was on the
// fence line. The region itself includes every animal (see below).
function toPercent(coord: MapLatLng, r: Region) {
  const { west, north, east, south } = r;
  const width = east - west || 1;
  const height = north - south || 1;
  const x = ((coord.longitude - west) / width) * 100;
  const y = ((north - coord.latitude) / height) * 100;
  return {
    left: `${x}%`,
    top: `${y}%`,
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

/**
 * Point pressed, relative to the pressed element. react-native-web only fills
 * locationX/Y on responder events; a Pressable gets the DOM event, so fall
 * back to its client position minus the element's box. (Without this every
 * tapped fence point was NaN.)
 */
function pressPoint(e: GestureResponderEvent): { x: number; y: number } | null {
  const { locationX, locationY } = e.nativeEvent;
  if (Number.isFinite(locationX) && Number.isFinite(locationY)) return { x: locationX, y: locationY };
  const dom = e.nativeEvent as unknown as { clientX?: number; clientY?: number };
  const target = e.currentTarget as unknown as {
    getBoundingClientRect?: () => { left: number; top: number };
  };
  if (dom.clientX == null || dom.clientY == null || !target?.getBoundingClientRect) return null;
  const rect = target.getBoundingClientRect();
  return { x: dom.clientX - rect.left, y: dom.clientY - rect.top };
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
    onMapPress,
  }: RanchMapProps,
  ref: React.ForwardedRef<RanchMapHandle>
) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<MapLatLng | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  // Set by fitToCoordinates; until then the region follows fences + animals.
  const [userRegion, setUserRegion] = useState<Region | null>(null);

  // Frame fences AND animals, so an animal far outside every fence is still
  // on screen.
  const frameCoords = useMemo(
    () => [
      ...polygons.flatMap((p) => p.coords),
      ...locations
        .filter((l) => l.latitude != null && l.longitude != null)
        .map((l) => ({ latitude: l.latitude as number, longitude: l.longitude as number })),
    ],
    [polygons, locations]
  );

  const region: Region = useMemo(() => {
    if (userRegion) return userRegion;
    const b = computeBounds(frameCoords);
    if (b) return computeRegion(b);
    const { latitude, longitude, latitudeDelta, longitudeDelta } = RANCH_REGION;
    return {
      west: longitude - longitudeDelta / 2,
      east: longitude + longitudeDelta / 2,
      south: latitude - latitudeDelta / 2,
      north: latitude + latitudeDelta / 2,
    };
  }, [frameCoords, userRegion]);

  const fitToCoordinates = useCallback<NonNullable<RanchMapHandle['fitToCoordinates']>>(
    (coords, opts) => {
      const b = computeBounds(coords);
      if (!b) return;
      setUserRegion(computeRegion(b, opts?.edgePadding ? 0.5 : 0.3));
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

  // Zooms around the current centre: each level halves (or doubles) the span.
  const zoomBy = useCallback(
    (delta: number) => {
      const factor = Math.pow(2, -delta);
      const cLat = (region.north + region.south) / 2;
      const cLng = (region.west + region.east) / 2;
      const halfLat = ((region.north - region.south) / 2) * factor;
      const halfLng = ((region.east - region.west) / 2) * factor;
      setUserRegion({ west: cLng - halfLng, east: cLng + halfLng, south: cLat - halfLat, north: cLat + halfLat });
    },
    [region]
  );

  useImperativeHandle(ref, () => ({ fitToCoordinates, getCenter, zoomBy }), [fitToCoordinates, getCenter, zoomBy]);

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
          if (draggingIdx != null && onDragVertex) {
            onDragVertex(draggingIdx, coord);
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
          if (draggingIdx != null) {
            if (onDragVertex) onDragVertex(draggingIdx, coord);
            setDraggingIdx(null);
          }
          setCursor(null);
        },
      }),
    [drawing, size.width, size.height, onDragVertex, region, draggingIdx]
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
            onMapPress?.();
            if (!drawing || !size.width || !size.height) return;
            const pt = pressPoint(e);
            if (!pt) return;
            onPressCoordinate(fromPercent((pt.x / size.width) * 100, (pt.y / size.height) * 100, region));
          }}
          onLongPress={(e) => {
            if (!drawing || !size.width || !size.height) return;
            const pt = pressPoint(e);
            if (!pt) return;
            onPressCoordinate(fromPercent((pt.x / size.width) * 100, (pt.y / size.height) * 100, region));
          }}>
          {size.width > 0 ? (
            <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
              {polygons.map((p) => {
                const coords = cleanPolygonCoords(p.coords);
                if (coords.length < 3 || p.isActive === false) return null;
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
                if (coords.length < 3 || p.isActive === false) return null;
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
                const active = p.isActive !== false;
                return (
                  <SvgPolygon
                    key={`fill-${p.id}`}
                    points={pts}
                    fill={drawing ? MapPalette.fenceFillDrawing : active ? FENCE_FILL : MapPalette.inactiveFill}
                    stroke={active ? FENCE_STROKE : MapPalette.inactiveStroke}
                    strokeWidth={active ? FENCE_STROKE_WIDTH : 3}
                    strokeDasharray={active ? undefined : '6 5'}
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
                p.isActive === false && styles.fenceLabelOff,
                { left: pos.left as DimensionValue, top: pos.top as DimensionValue },
              ]}>
              <Text style={[styles.fenceLabelText, p.isActive === false && styles.fenceLabelTextOff]} numberOfLines={1}>
                {p.isActive === false ? `${p.name} · off` : p.name}
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
                  onPressIn={() => setDraggingIdx(index)}
                  onPressOut={() => setDraggingIdx(null)}
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
          const meta = StatusMeta[statusKey(item.animal_status, item.stale)];
          const urgent = !item.stale && (item.animal_status === 'breach' || item.animal_status === 'near_boundary');
          return (
            <Pressable
              key={item.livestock_id}
              onPress={() => !drawing && onMarkerPress(item.livestock_id)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, tag ${item.tag_id}, ${meta.label}`}
              style={[
                styles.marker,
                { left: pos.left as DimensionValue, top: pos.top as DimensionValue },
                drawing && styles.markerDisabled,
              ]}>
              <View
                style={[
                  styles.tag,
                  { borderColor: meta.color },
                  item.stale && styles.tagStale,
                  urgent && { backgroundColor: meta.soft },
                ]}>
                <View style={[styles.tagDot, { backgroundColor: item.stale ? Colors.surface : meta.color, borderColor: meta.color }]} />
                <Text style={[styles.tagText, { color: meta.ink }]} numberOfLines={1}>
                  {item.stale
                    ? `${item.tag_id} · no fix`
                    : item.animal_status === 'breach'
                      ? `${item.tag_id} · outside`
                      : item.tag_id}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
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
    backgroundColor: MapPalette.webSatellite,
  },
  standard: {
    backgroundColor: MapPalette.webPasture,
  },
  marker: {
    position: 'absolute',
    // Anchored on the tag's left dot, which sits on the animal's position.
    marginLeft: -12,
    marginTop: -14,
    minHeight: 28,
    justifyContent: 'center',
    zIndex: 2,
  },
  markerDisabled: {
    opacity: 0.6,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 140,
    paddingLeft: 6,
    paddingRight: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 2,
    backgroundColor: Colors.surface,
    ...Shadows.raised,
  },
  tagStale: { borderStyle: 'dashed' },
  tagDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  tagText: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    lineHeight: 16,
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
    backgroundColor: Colors.surface,
    borderWidth: 3,
    borderColor: DRAFT_STROKE,
    ...Shadows.raised,
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
    backgroundColor: MapPalette.attributionBg,
    zIndex: 3,
  },
  fenceLabel: {
    position: 'absolute',
    marginLeft: -65,
    marginTop: -13,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: FENCE_STROKE,
    width: 130,
    alignItems: 'center',
    zIndex: 3,
  },
  fenceLabelOff: { borderColor: MapPalette.inactiveStroke, borderStyle: 'dashed' },
  fenceLabelText: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.primaryDark,
  },
  fenceLabelTextOff: { color: Colors.offlineInk },
});
