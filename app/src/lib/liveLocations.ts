import type { LivestockLocation, LocationLog } from '@/types/database';

export type LocationReading = Pick<LocationLog, 'collar_id' | 'latitude' | 'longitude' | 'timestamp' | 'sats'>;

function fixTime(timestamp: string | null): number {
  const time = timestamp === null ? NaN : Date.parse(timestamp);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Keep only the newest fix per collar while realtime events are batched. */
export function queueLocationReading(pending: Map<string, LocationReading>, reading: LocationReading): void {
  if (!Number.isFinite(fixTime(reading.timestamp))) return;
  const previous = pending.get(reading.collar_id);
  if (!previous || fixTime(reading.timestamp) > fixTime(previous.timestamp)) {
    pending.set(reading.collar_id, reading);
  }
}

/** Apply GPS data only; pairing, health and fence decisions come from their own server updates. */
export function applyLocationReadings(
  locations: LivestockLocation[],
  readings: ReadonlyMap<string, LocationReading>
): LivestockLocation[] {
  let changed = false;
  const next = locations.map((location) => {
    const reading = location.collar_id ? readings.get(location.collar_id) : undefined;
    if (!reading || fixTime(reading.timestamp) <= fixTime(location.last_seen_at)) return location;
    changed = true;
    return {
      ...location,
      latitude: reading.latitude,
      longitude: reading.longitude,
      last_seen_at: reading.timestamp,
      sats: reading.sats,
    };
  });
  return changed ? next : locations;
}

/** A slow refresh must not overwrite a fix that arrived while its query was in flight. */
export function reconcileLocations(
  current: LivestockLocation[],
  incoming: LivestockLocation[]
): LivestockLocation[] {
  const byAnimal = new Map(current.map((location) => [location.livestock_id, location]));
  return incoming.map((location) => {
    const previous = byAnimal.get(location.livestock_id);
    if (
      !previous ||
      previous.collar_id !== location.collar_id ||
      previous.latitude === null ||
      previous.longitude === null ||
      !Number.isFinite(fixTime(previous.last_seen_at)) ||
      fixTime(previous.last_seen_at) < fixTime(location.last_seen_at)
    ) {
      return location;
    }
    return {
      ...location,
      latitude: previous.latitude,
      longitude: previous.longitude,
      last_seen_at: previous.last_seen_at,
      sats: previous.sats,
    };
  });
}
