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
  Image,
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
import { OSM_ATTRIBUTION_LABEL, OSM_MAX_ZOOM, osmTileUrl } from '@/lib/osmTiles';
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

/**
 * Web Mercator, in a normalised [0,1] world square with y pointing down — the
 * projection raster tiles are cut in. Positions here must agree with the tile
 * grid exactly, or fences drift off the roads they were drawn along.
 */
const TILE_SIZE = 256;
const MERCATOR_MAX_LAT = 85.0511;
const MAX_TILES = 200;

const clampLat = (lat: number) => Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));

const lonToWorldX = (lon: number) => (lon + 180) / 360;
const latToWorldY = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360)) / (2 * Math.PI);
const worldXToLon = (x: number) => x * 360 - 180;
const worldYToLat = (y: number) =>
  (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);

type WorldBox = { x0: number; y0: number; w: number; h: number };

function worldBox(r: Region): WorldBox {
  const x0 = lonToWorldX(r.west);
  const y0 = latToWorldY(r.north);
  return {
    x0,
    y0,
    w: lonToWorldX(r.east) - x0 || 1e-9,
    h: latToWorldY(r.south) - y0 || 1e-9,
  };
}

/**
 * Tiles are square, so x and y must share one scale. Expand the short axis to
 * match the canvas aspect — never crop, so everything that fit still fits.
 */
function fitRegionToAspect(r: Region, size: Size): Region {
  if (!size.width || !size.height) return r;
  const { x0, y0, w, h } = worldBox(r);
  const target = size.width / size.height;
  if (w / h < target) {
    const half = (h * target) / 2;
    const cx = x0 + w / 2;
    return { ...r, west: worldXToLon(cx - half), east: worldXToLon(cx + half) };
  }
  const half = w / target / 2;
  const cy = y0 + h / 2;
  return { ...r, north: worldYToLat(cy - half), south: worldYToLat(cy + half) };
}

function toPercent(coord: MapLatLng, r: Region) {
  const { x0, y0, w, h } = worldBox(r);
  const x = ((lonToWorldX(coord.longitude) - x0) / w) * 100;
  const y = ((latToWorldY(coord.latitude) - y0) / h) * 100;
  return {
    left: `${Math.max(0, Math.min(100, x))}%`,
    top: `${Math.max(0, Math.min(100, y))}%`,
  };
}

function fromPercent(xPct: number, yPct: number, r: Region): MapLatLng {
  const { x0, y0, w, h } = worldBox(r);
  return {
    longitude: worldXToLon(x0 + (xPct / 100) * w),
    latitude: worldYToLat(y0 + (yPct / 100) * h),
  };
}

type Tile = { key: string; url: string; left: number; top: number; size: number };

function computeTiles(r: Region, size: Size): Tile[] {
  if (!size.width || !size.height) return [];
  const { x0, y0, w } = worldBox(r);
  const pxPerWorld = size.width / w;
  const zoom = Math.max(0, Math.min(OSM_MAX_ZOOM, Math.round(Math.log2(pxPerWorld / TILE_SIZE))));
  const n = 2 ** zoom;
  const tilePx = pxPerWorld / n;

  const minX = Math.floor(x0 * n);
  const maxX = Math.floor((x0 + w) * n);
  const minY = Math.max(0, Math.floor(y0 * n));
  const maxY = Math.min(n - 1, Math.floor((y0 + (size.height / pxPerWorld)) * n));
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_TILES) return [];

  const tiles: Tile[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        // Wrap x so panning across the antimeridian still requests a real tile.
        url: osmTileUrl(zoom, ((x % n) + n) % n, y),
        left: (x / n - x0) * pxPerWorld,
        top: (y / n - y0) * pxPerWorld,
        // Round up: fractional tile sizes leave hairline seams between images.
        size: Math.ceil(tilePx) + 1,
      });
    }
  }
  return tiles;
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
  const [userRegion, setUserRegion] = useState<Region | null>(null);

  const polygonCoords = useMemo(
    () => polygons.flatMap((p) => p.coords),
    [polygons]
  );

  const baseRegion: Region = useMemo(() => {
    if (userRegion) return userRegion;
    const b = computeBounds(polygonCoords);
    if (b) return computeRegion(b);
    const { latitude, longitude, latitudeDelta, longitudeDelta } = RANCH_REGION;
    return {
      west: longitude - longitudeDelta / 2,
      east: longitude + longitudeDelta / 2,
      south: latitude - latitudeDelta / 2,
      north: latitude + latitudeDelta / 2,
    };
  }, [userRegion, polygonCoords]);

  const region: Region = useMemo(() => fitRegionToAspect(baseRegion, size), [baseRegion, size]);
  const tiles = useMemo(() => computeTiles(region, size), [region, size]);

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
        style={styles.canvas}
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
        {tiles.map((t) => (
          <Image
            key={t.key}
            source={{ uri: t.url }}
            style={{ position: 'absolute', left: t.left, top: t.top, width: t.size, height: t.size }}
          />
        ))}

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

        <View style={styles.attribution} pointerEvents="none">
          <Text style={styles.attributionText}>{OSM_ATTRIBUTION_LABEL}</Text>
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
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 3,
  },
  attributionText: {
    fontSize: 9,
    color: '#333',
  },
});
