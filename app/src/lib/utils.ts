import { Colors } from '@/constants/theme';
import type { Alert, AnimalStatus } from '@/types/database';

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * A position or collar heartbeat older than this is shown as stale: grey marker,
 * collar counted as offline. The collar sends every ~3 s, so 3 min of silence
 * means it has really stopped reporting, not just missed a packet.
 */
export const STALE_AFTER_MS = 3 * 60_000;

export function isStale(iso: string | null | undefined, now: number = Date.now()): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return !Number.isFinite(t) || now - t > STALE_AFTER_MS;
}

/** Matches the server's low-battery alert threshold (alert below 20, resolved at 30+). */
export const LOW_BATTERY_PERCENT = 20;

export type BatteryTone = 'critical' | 'warning' | 'healthy' | 'unknown';

export function batteryTone(level: number | null | undefined): BatteryTone {
  if (level == null) return 'unknown';
  if (level < LOW_BATTERY_PERCENT) return 'critical';
  if (level < 50) return 'warning';
  return 'healthy';
}

export function batteryColor(level: number | null | undefined): string {
  switch (batteryTone(level)) {
    case 'critical':
      return Colors.critical;
    case 'warning':
      return Colors.caution;
    case 'unknown':
      return Colors.textMuted;
    default:
      return Colors.success;
  }
}

/** "87%", or "—" when the collar cannot measure its battery. */
export function batteryLabel(level: number | null | undefined): string {
  return level == null ? '—' : `${level}%`;
}

export function statusMarkerColor(status: AnimalStatus, stale = false): string {
  if (stale) return Colors.stale;
  switch (status) {
    case 'breach':
      return Colors.breach;
    case 'near_boundary':
      return Colors.nearBoundary;
    case 'resting':
      return Colors.resting;
    default:
      return Colors.grazing;
  }
}

export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function geoJsonToLatLngs(coords: number[][][]) {
  return (coords[0] ?? []).map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }));
}

/** Drops the closing vertex of a closed ring (GeoJSON rings repeat the first point last). */
export function openRing<T extends { latitude: number; longitude: number }>(coords: T[]): T[] {
  if (coords.length < 2) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  const closed =
    Math.abs(first.latitude - last.latitude) < 1e-9 && Math.abs(first.longitude - last.longitude) < 1e-9;
  return closed ? coords.slice(0, -1) : coords;
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

/** Default warning distance, matching the database default for geofences.warning_buffer_meters. */
export const DEFAULT_WARNING_BUFFER_M = 30;

/**
 * Metres of hysteresis (contract v2). GPS jitter of a few metres must not flip
 * an animal sitting on a line between states on every reading.
 */
export const FENCE_HYSTERESIS_M = 3;

export type EvaluableFence = {
  id: string;
  name: string;
  ring: LatLng[];
  warningBufferMeters: number;
};

export type FenceEval = {
  /** Same values as livestock.animal_status. */
  status: AnimalStatus;
  /** Fence the point is deepest inside, or the nearest fence when in breach. Null when there are no fences. */
  fenceId: string | null;
  fenceName: string | null;
  /**
   * Inside a fence: metres from that fence's edge (depth).
   * In breach: metres outside the nearest fence.
   * No fences: Infinity.
   */
  distanceMeters: number;
  insideAnyFence: boolean;
};

/**
 * Fence semantics, contract v2 — identical to the database trigger
 * detect_geofence_events(), which is the source of truth for livestock. The
 * app only runs this for the phone's own position on the map screen.
 *
 * - Breach: outside every active fence, at any distance.
 * - Warning (near_boundary): inside a fence but within that fence's buffer of
 *   its edge, using the fence the point is deepest inside.
 * - No active fences: safe.
 * - Hysteresis: leaving breach needs >= 3 m depth (then warning if within the
 *   buffer, else grazing); warning -> grazing needs depth > buffer + 3 m.
 * - `resting` is never overwritten by grazing.
 *
 * Callers pass only active fences.
 */
export function evaluateAgainstFences(
  pt: LatLng,
  fences: EvaluableFence[],
  prevStatus: AnimalStatus | null = null
): FenceEval {
  const usable = fences.filter((f) => f.ring.length >= 3);
  const keepResting = (status: AnimalStatus): AnimalStatus =>
    status === 'grazing' && prevStatus === 'resting' ? 'resting' : status;

  if (usable.length === 0) {
    return {
      status: keepResting('grazing'),
      fenceId: null,
      fenceName: null,
      distanceMeters: Number.POSITIVE_INFINITY,
      insideAnyFence: false,
    };
  }

  let deepest: { fence: EvaluableFence; depth: number } | null = null;
  let nearestOutside: { fence: EvaluableFence; d: number } | null = null;

  for (const fence of usable) {
    const d = distanceToRingMeters(pt, fence.ring);
    if (pointInPolygon(pt, fence.ring)) {
      if (!deepest || d > deepest.depth) deepest = { fence, depth: d };
    } else if (!nearestOutside || d < nearestOutside.d) {
      nearestOutside = { fence, d };
    }
  }

  if (!deepest) {
    const nearest = nearestOutside!;
    return {
      status: 'breach',
      fenceId: nearest.fence.id,
      fenceName: nearest.fence.name,
      distanceMeters: nearest.d,
      insideAnyFence: false,
    };
  }

  const { fence, depth } = deepest;
  const buffer = fence.warningBufferMeters;
  let status: AnimalStatus;
  if (prevStatus === 'breach' && depth < FENCE_HYSTERESIS_M) {
    status = 'breach';
  } else if (prevStatus === 'near_boundary') {
    status = depth > buffer + FENCE_HYSTERESIS_M ? 'grazing' : 'near_boundary';
  } else {
    status = depth <= buffer ? 'near_boundary' : 'grazing';
  }

  return {
    status: keepResting(status),
    fenceId: fence.id,
    fenceName: fence.name,
    distanceMeters: depth,
    insideAnyFence: true,
  };
}

export type TrainingStats = {
  /** approach_warning alerts seen. */
  warnings: number;
  /** Of those, how many were followed by a breach before the warning ended. */
  escalated: number;
  /** % of warnings that did not escalate, or null when there were no warnings. */
  successRate: number | null;
};

const ESCALATION_GRACE_MS = 60_000;

function toStats(warnings: number, escalated: number): TrainingStats {
  return {
    warnings,
    escalated,
    successRate: warnings === 0 ? null : Math.round(((warnings - escalated) / warnings) * 100),
  };
}

/**
 * Training success from alert history: a warning "worked" when the animal
 * turned back instead of breaching. A warning escalated if a breach alert for
 * the same animal was raised between the warning and the moment it ended
 * (the server resolves the warning as the breach starts), plus a small grace.
 */
export function trainingStatsByAnimal(alerts: Alert[], now: number = Date.now()): Record<string, TrainingStats> {
  const byAnimal: Record<string, { warnings: Alert[]; breaches: number[] }> = {};
  for (const a of alerts) {
    if (!a.livestock_id) continue;
    const bucket = (byAnimal[a.livestock_id] ??= { warnings: [], breaches: [] });
    if (a.alert_type === 'approach_warning') bucket.warnings.push(a);
    else if (a.alert_type === 'boundary_breach') bucket.breaches.push(new Date(a.created_at).getTime());
  }

  const result: Record<string, TrainingStats> = {};
  for (const [livestockId, { warnings, breaches }] of Object.entries(byAnimal)) {
    let escalated = 0;
    for (const w of warnings) {
      const start = new Date(w.created_at).getTime();
      const end = (w.resolved_at ? new Date(w.resolved_at).getTime() : now) + ESCALATION_GRACE_MS;
      if (breaches.some((b) => b >= start && b <= end)) escalated++;
    }
    result[livestockId] = toStats(warnings.length, escalated);
  }
  return result;
}

export function combineTrainingStats(stats: TrainingStats[]): TrainingStats {
  const warnings = stats.reduce((s, x) => s + x.warnings, 0);
  const escalated = stats.reduce((s, x) => s + x.escalated, 0);
  return toStats(warnings, escalated);
}
