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
export type ConnectionType = 'LTE' | 'Satellite';
export type AnimalStatus = 'grazing' | 'near_boundary' | 'breach' | 'resting';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  farm_name: string | null;
  created_at: string;
}

export interface Collar {
  id: string;
  device_hardware_id: string;
  battery_level: number;
  status: CollarStatus;
  connection_type: ConnectionType;
  signal_strength: string;
  firmware_version: string;
  last_ping_at: string | null;
}

export interface Livestock {
  id: string;
  tag_id: string;
  name: string;
  breed: string;
  age: number | null;
  health_status: HealthStatus;
  animal_status: AnimalStatus;
  collar_id: string | null;
  training_success_rate: number;
  audio_warning_count: number;
  vibration_pulse_count: number;
  created_at?: string;
  collar?: Collar | null;
}

export interface Geofence {
  id: string;
  name: string;
  is_active: boolean;
  warning_buffer_meters: number;
  created_by: string | null;
  /** GeoJSON Polygon or LatLng array for map rendering */
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
  timestamp: string;
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
  livestock?: Pick<Livestock, 'id' | 'name' | 'tag_id'> | null;
}

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
  latitude: number | null;
  longitude: number | null;
  last_seen_at: string | null;
}

export type MapLatLng = {
  latitude: number;
  longitude: number;
};
