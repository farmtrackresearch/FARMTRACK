import type {
  Alert,
  Collar,
  Geofence,
  Livestock,
  LivestockLocation,
  Profile,
} from '@/types/database';
import { RANCH_REGION } from '@/constants/theme';

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const DEMO_PROFILE: Profile = {
  id: 'demo-admin',
  full_name: 'Jordan Hale',
  role: 'admin',
  farm_name: 'Montana Ranch Operations',
  created_at: ago(60 * 24 * 30),
};

export const DEMO_COLLARS: Collar[] = [];

export const DEMO_LIVESTOCK: Livestock[] = [];

export const DEMO_LOCATIONS: LivestockLocation[] = [];

export const DEMO_GEOFENCES: Geofence[] = [];

export const DEMO_ALERTS: Alert[] = [];

export { RANCH_REGION as _RANCH_REGION_KEEP, ago as _ago_keep };
