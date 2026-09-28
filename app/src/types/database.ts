/**
 * Hand-maintained mirror of the Supabase schema (app/supabase/schema.sql).
 * Keep in step with the database: nullable columns are `| null` here.
 */
export type UserRole = 'admin' | 'staff';
export type CollarStatus = 'active' | 'offline';
export type HealthStatus = 'healthy' | 'monitoring' | 'critical';
export type AlertType =
  | 'approach_warning'
  | 'boundary_breach'
  | 'low_battery'
  | 'stationary'
  | 'info';
export type AlertStatus = 'unresolved' | 'resolved';
export type ConnectionType = 'LTE' | 'Satellite' | 'LoRa';
export type AnimalStatus = 'grazing' | 'near_boundary' | 'breach' | 'resting';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  farm_name: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Collar {
  id: string;
  device_hardware_id: string;
  /** 0-100, or null while the collar has no battery sensing fitted. */
  battery_level: number | null;
  status: CollarStatus;
  connection_type: ConnectionType;
  signal_strength: string;
  firmware_version: string;
  /** Last time the gateway heard this collar (with or without a GPS fix). */
  last_ping_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Livestock {
  id: string;
  tag_id: string;
  name: string;
  breed: string;
  age: number | null;
  health_status: HealthStatus;
  /** Decided by the database trigger; the app never writes it. */
  animal_status: AnimalStatus;
  collar_id: string | null;
  /** Legacy column, never written. Training success is derived from alert history instead. */
  training_success_rate: number | null;
  /** Incremented by the database each time the animal enters warning or breach. */
  audio_warning_count: number | null;
  /** Always 0: no vibration motor is fitted. */
  vibration_pulse_count: number | null;
  created_at?: string;
  updated_at?: string;
  collar?: Collar | null;
}

/** Shape returned by the get_geofences_geojson() RPC. */
export interface Geofence {
  id: string;
  name: string;
  is_active: boolean;
  warning_buffer_meters: number | null;
  created_by: string | null;
  /** GeoJSON Polygon, [longitude, latitude] order. */
  coordinates: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface LocationLog {
  id: string;
  collar_id: string;
  latitude: number;
  longitude: number;
  /** When the fix was taken (collar GPS time when plausible). */
  timestamp: string;
  /** When the server stored the row. */
  received_at: string | null;
  // Populated by ingest_telemetry() for readings that came in over LoRa.
  // Null on rows written any other way (manual inserts, seed data).
  seq: number | null;
  rssi: number | null;
  snr: number | null;
  sats: number | null;
  gateway_id: string | null;
}

export interface Alert {
  id: string;
  collar_id: string | null;
  livestock_id: string | null;
  geofence_id: string | null;
  alert_type: AlertType;
  status: AlertStatus;
  title: string;
  description: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  livestock?: Pick<Livestock, 'id' | 'name' | 'tag_id'> | null;
}

/** Row of the latest_livestock_locations view. */
export interface LivestockLocation {
  livestock_id: string;
  tag_id: string;
  name: string;
  breed: string;
  animal_status: AnimalStatus;
  health_status: HealthStatus;
  collar_id: string | null;
  device_hardware_id: string | null;
  battery_level: number | null;
  collar_status: CollarStatus | null;
  connection_type: ConnectionType | null;
  /** Average of the last 5 fixes. */
  latitude: number | null;
  longitude: number | null;
  /** Time of the newest fix. */
  last_seen_at: string | null;
  /** Last time the collar was heard at all (from collars). */
  last_ping_at: string | null;
  /** Satellites used in the newest fix. */
  sats: number | null;
}

/** Single-row table (id = 1). Written only through set_collars_muted(). */
export interface FarmSettings {
  id: number;
  collars_muted_until: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface PushToken {
  token: string;
  profile_id: string;
  platform: string | null;
  created_at: string;
  updated_at: string;
}

export type MapLatLng = {
  latitude: number;
  longitude: number;
};
