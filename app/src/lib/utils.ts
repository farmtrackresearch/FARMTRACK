export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function batteryColor(level: number): string {
  if (level < 20) return '#C62828';
  if (level < 50) return '#E67E22';
  return '#2D5A27';
}

export function batteryTone(level: number): 'critical' | 'warning' | 'healthy' {
  if (level < 20) return 'critical';
  if (level < 50) return 'warning';
  return 'healthy';
}

export function statusMarkerColor(
  status: 'grazing' | 'near_boundary' | 'breach' | 'resting'
): string {
  switch (status) {
    case 'breach':
      return '#C0392B';
    case 'near_boundary':
      return '#E67E22';
    case 'resting':
      return '#4A5568';
    default:
      return '#2D5A27';
  }
}

export function geoJsonToLatLngs(coords: number[][][]) {
  return (coords[0] ?? []).map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }));
}

export function latLngsToRing(
  points: { latitude: number; longitude: number }[]
): number[][] {
  const ring = points.map((p) => [p.longitude, p.latitude]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([...ring[0]]);
  }
  return ring;
}

type LatLng = { latitude: number; longitude: number };

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude);
  const la2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pointInPolygon(pt: LatLng, ring: LatLng[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude;
    const yi = ring[i].latitude;
    const xj = ring[j].longitude;
    const yj = ring[j].latitude;
    const intersect =
      yi > pt.latitude !== yj > pt.latitude &&
      pt.longitude < ((xj - xi) * (pt.latitude - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToRingMeters(pt: LatLng, ring: LatLng[]): number {
  if (ring.length === 0) return Number.POSITIVE_INFINITY;
  const n = ring.length;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dSeg = pointToSegmentMeters(pt, a, b);
    if (dSeg < min) min = dSeg;
  }
  return min;
}

function pointToSegmentMeters(pt: LatLng, a: LatLng, b: LatLng): number {
  // Project pt onto line a-b in equirectangular approx (fine for short segments <~10km)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const latMid = (a.latitude + b.latitude) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const ax = toRad(a.longitude) * R * kx;
  const ay = toRad(a.latitude) * R;
  const bx = toRad(b.longitude) * R * kx;
  const by = toRad(b.latitude) * R;
  const px = toRad(pt.longitude) * R * kx;
  const py = toRad(pt.latitude) * R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Shoelace formula over an equirectangular-projected ring; good enough for field-sized polygons. */
export function polygonAreaHectares(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const latMid = points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const R = 6371000;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const toXY = (p: LatLng) => ({
    x: ((p.longitude * Math.PI) / 180) * R * kx,
    y: ((p.latitude * Math.PI) / 180) * R,
  });
  const xy = points.map(toXY);
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2 / 10000;
}

function segmentsIntersect(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d = (a: LatLng, b: LatLng, c: LatLng) =>
    (b.longitude - a.longitude) * (c.latitude - a.latitude) -
    (b.latitude - a.latitude) * (c.longitude - a.longitude);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True if any two non-adjacent edges of the closed ring cross each other. */
export function isSelfIntersecting(points: LatLng[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (isAdjacent) continue;
      if (segmentsIntersect(a1, a2, points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

const METERS_PER_DEG_LAT = 111320;

function metersToLatLngOffset(center: LatLng, dxMeters: number, dyMeters: number): LatLng {
  const dLat = dyMeters / METERS_PER_DEG_LAT;
  const dLng = dxMeters / (METERS_PER_DEG_LAT * Math.cos((center.latitude * Math.PI) / 180));
  return { latitude: center.latitude + dLat, longitude: center.longitude + dLng };
}

/** Preset boundary templates — dropped near the map center, then dragged into shape via the existing vertex handles. */
export function makeRectangleTemplate(
  center: LatLng,
  halfWidthMeters = 60,
  halfHeightMeters = 40
): LatLng[] {
  return [
    metersToLatLngOffset(center, -halfWidthMeters, halfHeightMeters),
    metersToLatLngOffset(center, halfWidthMeters, halfHeightMeters),
    metersToLatLngOffset(center, halfWidthMeters, -halfHeightMeters),
    metersToLatLngOffset(center, -halfWidthMeters, -halfHeightMeters),
  ];
}

export function makeEllipseTemplate(
  center: LatLng,
  radiusXMeters = 50,
  radiusYMeters = 50,
  numPoints = 28
): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < numPoints; i++) {
    const theta = (i / numPoints) * 2 * Math.PI;
    pts.push(
      metersToLatLngOffset(center, radiusXMeters * Math.cos(theta), radiusYMeters * Math.sin(theta))
    );
  }
  return pts;
}

export type FenceEval = {
  state: 'inside' | 'warning' | 'breach' | 'grazing';
  fenceId: string | null;
  fenceName: string | null;
  distanceMeters: number;
  insideAnyFence: boolean;
};

export function evaluateAgainstFences(
  pt: LatLng,
  fences: { id: string; name: string; ring: LatLng[]; warningBufferMeters: number }[]
): FenceEval {
  let insideAnyFence = false;
  let nearestOutside: { fenceId: string; fenceName: string; d: number } | null = null;
  let nearestInside: { fenceId: string; fenceName: string; d: number } | null = null;

  for (const fence of fences) {
    if (fence.ring.length < 3) continue;
    const inside = pointInPolygon(pt, fence.ring);
    if (inside) {
      insideAnyFence = true;
      const d = distanceToRingMeters(pt, fence.ring);
      if (!nearestInside || d < nearestInside.d) {
        nearestInside = { fenceId: fence.id, fenceName: fence.name, d };
      }
    } else {
      const d = distanceToRingMeters(pt, fence.ring);
      if (!nearestOutside || d < nearestOutside.d) {
        nearestOutside = { fenceId: fence.id, fenceName: fence.name, d };
      }
    }
  }

  // If user INSIDE any fence — they have successfully crossed OUT of the grazing field if they are NOT inside any.
  // But actually: Breach = outside ALL fences and close to a boundary (pasture breach).
  // Inside = safely in a pasture; warning if they are <buffer from the edge inside/outside.
  if (insideAnyFence && nearestInside) {
    if (nearestInside.d <= (fences.find((f) => f.id === nearestInside!.fenceId)?.warningBufferMeters ?? 30)) {
      return {
        state: 'warning',
        fenceId: nearestInside.fenceId,
        fenceName: nearestInside.fenceName,
        distanceMeters: nearestInside.d,
        insideAnyFence: true,
      };
    }
    return {
      state: 'inside',
      fenceId: nearestInside.fenceId,
      fenceName: nearestInside.fenceName,
      distanceMeters: nearestInside.d,
      insideAnyFence: true,
    };
  }

  if (!insideAnyFence && nearestOutside) {
    const buf = fences.find((f) => f.id === nearestOutside!.fenceId)?.warningBufferMeters ?? 30;
    if (nearestOutside.d <= buf) {
      return {
        state: 'breach',
        fenceId: nearestOutside.fenceId,
        fenceName: nearestOutside.fenceName,
        distanceMeters: nearestOutside.d,
        insideAnyFence: false,
      };
    }
  }

  return {
    state: 'grazing',
    fenceId: null,
    fenceName: null,
    distanceMeters: nearestOutside?.d ?? Number.POSITIVE_INFINITY,
    insideAnyFence,
  };
}
