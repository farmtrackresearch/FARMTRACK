-- =============================================================================
-- FarmTrack: GPS-Enabled Virtual Fencing System
-- Supabase PostgreSQL Schema with PostGIS + Row Level Security
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE user_role AS ENUM ('admin', 'staff');
CREATE TYPE collar_status AS ENUM ('active', 'offline');
CREATE TYPE health_status AS ENUM ('healthy', 'monitoring', 'critical');
CREATE TYPE alert_type AS ENUM (
  'approach_warning',
  'boundary_breach',
  'low_battery',
  'stationary',
  'info'
);
CREATE TYPE alert_status AS ENUM ('unresolved', 'resolved');
CREATE TYPE connection_type AS ENUM ('LTE', 'Satellite');
CREATE TYPE animal_status AS ENUM ('grazing', 'near_boundary', 'breach', 'resting');

-- =============================================================================
-- TABLES
-- =============================================================================

-- 1. profiles (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'staff',
  farm_name TEXT DEFAULT 'Montana Ranch Operations',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. collars
CREATE TABLE public.collars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_hardware_id TEXT UNIQUE NOT NULL,
  battery_level INTEGER NOT NULL DEFAULT 100 CHECK (battery_level BETWEEN 0 AND 100),
  status collar_status NOT NULL DEFAULT 'active',
  connection_type connection_type NOT NULL DEFAULT 'LTE',
  signal_strength TEXT NOT NULL DEFAULT 'Good',
  firmware_version TEXT NOT NULL DEFAULT '1.0.0',
  last_ping_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. livestock
CREATE TABLE public.livestock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  breed TEXT NOT NULL,
  age NUMERIC(4,1),
  health_status health_status NOT NULL DEFAULT 'healthy',
  animal_status animal_status NOT NULL DEFAULT 'grazing',
  collar_id UUID UNIQUE REFERENCES public.collars(id) ON DELETE SET NULL,
  training_success_rate INTEGER DEFAULT 0 CHECK (training_success_rate BETWEEN 0 AND 100),
  audio_warning_count INTEGER DEFAULT 0,
  vibration_pulse_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. geofences (PostGIS Polygon)
CREATE TABLE public.geofences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  coordinates GEOMETRY(Polygon, 4326) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  warning_buffer_meters NUMERIC(8,2) DEFAULT 30,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX geofences_coordinates_idx ON public.geofences USING GIST (coordinates);

-- 5. location_logs (PostGIS Point)
CREATE TABLE public.location_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collar_id UUID NOT NULL REFERENCES public.collars(id) ON DELETE CASCADE,
  location GEOMETRY(Point, 4326) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX location_logs_location_idx ON public.location_logs USING GIST (location);
CREATE INDEX location_logs_collar_ts_idx ON public.location_logs (collar_id, timestamp DESC);

-- 6. alerts
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collar_id UUID REFERENCES public.collars(id) ON DELETE SET NULL,
  livestock_id UUID REFERENCES public.livestock(id) ON DELETE SET NULL,
  geofence_id UUID REFERENCES public.geofences(id) ON DELETE SET NULL,
  alert_type alert_type NOT NULL,
  status alert_status NOT NULL DEFAULT 'unresolved',
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX alerts_status_created_idx ON public.alerts (status, created_at DESC);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'staff')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER collars_updated_at BEFORE UPDATE ON public.collars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER livestock_updated_at BEFORE UPDATE ON public.livestock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER geofences_updated_at BEFORE UPDATE ON public.geofences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sync lat/lng into PostGIS point on insert/update
CREATE OR REPLACE FUNCTION public.sync_location_point()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  RETURN NEW;
END;
$$;

CREATE TRIGGER location_logs_sync_point
  BEFORE INSERT OR UPDATE ON public.location_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_location_point();

-- Detect geofence breach / approach when a location is logged
CREATE OR REPLACE FUNCTION public.detect_geofence_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_livestock_id UUID;
  v_fence RECORD;
  v_distance DOUBLE PRECISION;
BEGIN
  SELECT id INTO v_livestock_id
  FROM public.livestock
  WHERE collar_id = NEW.collar_id
  LIMIT 1;

  IF v_livestock_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_fence IN
    SELECT id, name, coordinates, warning_buffer_meters
    FROM public.geofences
    WHERE is_active = TRUE
  LOOP
    -- Outside fence = boundary breach
    IF NOT ST_Contains(v_fence.coordinates, NEW.location) THEN
      INSERT INTO public.alerts (
        collar_id, livestock_id, geofence_id, alert_type, title, description
      )
      SELECT
        NEW.collar_id,
        v_livestock_id,
        v_fence.id,
        'boundary_breach',
        v_fence.name || ' Breach Detected',
        (SELECT name FROM public.livestock WHERE id = v_livestock_id)
          || ' has crossed the boundary line'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.alerts
        WHERE livestock_id = v_livestock_id
          AND geofence_id = v_fence.id
          AND alert_type = 'boundary_breach'
          AND status = 'unresolved'
          AND created_at > NOW() - INTERVAL '10 minutes'
      );

      UPDATE public.livestock
      SET animal_status = 'breach'
      WHERE id = v_livestock_id;

    ELSE
      -- Inside but within warning buffer
      v_distance := ST_Distance(
        NEW.location::geography,
        ST_Boundary(v_fence.coordinates)::geography
      );

      IF v_distance <= COALESCE(v_fence.warning_buffer_meters, 30) THEN
        INSERT INTO public.alerts (
          collar_id, livestock_id, geofence_id, alert_type, title, description
        )
        SELECT
          NEW.collar_id,
          v_livestock_id,
          v_fence.id,
          'approach_warning',
          'Near Boundary',
          (SELECT name FROM public.livestock WHERE id = v_livestock_id)
            || ' approaching ' || v_fence.name
        WHERE NOT EXISTS (
          SELECT 1 FROM public.alerts
          WHERE livestock_id = v_livestock_id
            AND geofence_id = v_fence.id
            AND alert_type = 'approach_warning'
            AND status = 'unresolved'
            AND created_at > NOW() - INTERVAL '10 minutes'
        );

        UPDATE public.livestock
        SET animal_status = 'near_boundary'
        WHERE id = v_livestock_id AND animal_status <> 'breach';
      ELSE
        UPDATE public.livestock
        SET animal_status = 'grazing'
        WHERE id = v_livestock_id AND animal_status IN ('near_boundary', 'breach');
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER location_logs_detect_events
  AFTER INSERT ON public.location_logs
  FOR EACH ROW EXECUTE FUNCTION public.detect_geofence_events();

-- Latest location per collar (for map markers)
CREATE OR REPLACE VIEW public.latest_livestock_locations AS
SELECT DISTINCT ON (l.id)
  l.id AS livestock_id,
  l.tag_id,
  l.name,
  l.breed,
  l.animal_status,
  l.health_status,
  c.id AS collar_id,
  c.device_hardware_id,
  c.battery_level,
  c.status AS collar_status,
  c.connection_type,
  ll.latitude,
  ll.longitude,
  ll.timestamp AS last_seen_at
FROM public.livestock l
LEFT JOIN public.collars c ON c.id = l.collar_id
LEFT JOIN public.location_logs ll ON ll.collar_id = c.id
ORDER BY l.id, ll.timestamp DESC NULLS LAST;

-- Geofence as GeoJSON helper for the mobile client
CREATE OR REPLACE FUNCTION public.get_geofences_geojson()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'name', name,
        'is_active', is_active,
        'warning_buffer_meters', warning_buffer_meters,
        'created_by', created_by,
        'coordinates', ST_AsGeoJSON(coordinates)::jsonb
      )
    ),
    '[]'::jsonb
  )
  FROM public.geofences;
$$;

-- Save geofence from GeoJSON polygon ring (admin only)
CREATE OR REPLACE FUNCTION public.upsert_geofence(
  p_id UUID,
  p_name TEXT,
  p_ring JSONB, -- [[lng, lat], ...] closed ring
  p_is_active BOOLEAN DEFAULT TRUE,
  p_warning_buffer_meters NUMERIC DEFAULT 30
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_geom GEOMETRY(Polygon, 4326);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can manage geofences';
  END IF;

  v_geom := ST_SetSRID(
    ST_MakePolygon(ST_GeomFromText(
      'LINESTRING(' ||
      (
        SELECT string_agg(
          (pt->>0) || ' ' || (pt->>1),
          ','
        )
        FROM jsonb_array_elements(p_ring) AS pt
      )
      || ')'
    )),
    4326
  );

  IF p_id IS NULL THEN
    INSERT INTO public.geofences (name, coordinates, is_active, warning_buffer_meters, created_by)
    VALUES (p_name, v_geom, p_is_active, p_warning_buffer_meters, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.geofences
    SET
      name = p_name,
      coordinates = v_geom,
      is_active = p_is_active,
      warning_buffer_meters = p_warning_buffer_meters
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livestock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can manage all profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- collars: staff read, admin full CRUD
CREATE POLICY "Authenticated users can view collars"
  ON public.collars FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert collars"
  ON public.collars FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update collars"
  ON public.collars FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete collars"
  ON public.collars FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- livestock: staff read, admin full CRUD
CREATE POLICY "Authenticated users can view livestock"
  ON public.livestock FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert livestock"
  ON public.livestock FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update livestock"
  ON public.livestock FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete livestock"
  ON public.livestock FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- geofences: staff read, admin full CRUD
CREATE POLICY "Authenticated users can view geofences"
  ON public.geofences FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert geofences"
  ON public.geofences FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update geofences"
  ON public.geofences FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete geofences"
  ON public.geofences FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- location_logs: all authenticated read; inserts allowed for service/device role via service key
CREATE POLICY "Authenticated users can view location logs"
  ON public.location_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert location logs"
  ON public.location_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- alerts: all authenticated read; staff can resolve; admin full
CREATE POLICY "Authenticated users can view alerts"
  ON public.alerts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can resolve alerts"
  ON public.alerts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can insert alerts"
  ON public.alerts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete alerts"
  ON public.alerts FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- =============================================================================
-- REALTIME
-- =============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.collars;
ALTER PUBLICATION supabase_realtime ADD TABLE public.livestock;

-- =============================================================================
-- SEED DATA (optional demo ranch near Montana coords)
-- =============================================================================

-- Note: Seed livestock/collars after creating auth users.
-- Example geofence (North Pasture) — run as admin after login:
--
-- SELECT public.upsert_geofence(
--   NULL,
--   'North Pasture',
--   '[
--     [-110.3620, 45.6780],
--     [-110.3500, 45.6780],
--     [-110.3500, 45.6860],
--     [-110.3620, 45.6860],
--     [-110.3620, 45.6780]
--   ]'::jsonb,
--   true,
--   30
-- );
