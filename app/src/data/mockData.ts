import type {
  Alert,
  Collar,
  FarmSettings,
  Geofence,
  Livestock,
  LivestockLocation,
  Profile,
} from '@/types/database';

/**
 * Demo mode data (no Supabase keys configured). Deliberately empty apart from
 * the profile: demo mode is for looking around the UI and drawing fences
 * locally, never for real animals.
 */
export const DEMO_PROFILE: Profile = {
  id: 'demo-admin',
  full_name: 'Demo User',
  role: 'admin',
  farm_name: 'Demo Farm',
  created_at: new Date().toISOString(),
};

export const DEMO_COLLARS: Collar[] = [];

export const DEMO_LIVESTOCK: Livestock[] = [];

export const DEMO_LOCATIONS: LivestockLocation[] = [];

export const DEMO_GEOFENCES: Geofence[] = [];

export const DEMO_ALERTS: Alert[] = [];

export const DEMO_FARM_SETTINGS: FarmSettings = {
  id: 1,
  collars_muted_until: null,
  updated_at: new Date().toISOString(),
  updated_by: null,
};
