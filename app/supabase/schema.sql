-- =============================================================================
-- FarmTrack: step 2 of 4 - the whole database, as one transaction.
--
-- Run 00_enum_values.sql first. Then: Supabase -> SQL Editor -> paste this
-- whole file -> Run. Expected result: "Success. No rows returned".
--
-- * Works on a brand-new Supabase project AND on the live database (checked
--   against the live export of 2026-09-26). It keeps every existing row.
-- * Safe to run again at any time: every step checks before it changes.
-- * One transaction: if any statement fails, NOTHING is changed. If the next
--   query you run says "current transaction is aborted", run ROLLBACK; once.
-- * It briefly locks location_logs. A gateway uploading at that moment gets
--   an error for a few seconds and retries; nothing is lost.
-- * WARNING/NOTICE messages are not shown by the SQL editor. Run
--   verify_setup.sql afterwards - it reports everything that matters.
--
-- Contract: see "Shared contract v2" (collar <-> gateway <-> database <-> app).
-- The fence rules here and evaluateAgainstFences() in app/src/lib/utils.ts
-- must stay identical.
-- =============================================================================

BEGIN;

-- PostGIS is in schema public on the live project and in `extensions` on a
-- new Supabase project; pgcrypto is in `extensions`. This covers both.
SET LOCAL search_path = public, extensions;
-- Give up instead of queueing behind a long lock (then just run it again).
SET LOCAL lock_timeout = '10s';

-- =============================================================================
-- 1. Extensions
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis  WITH SCHEMA extensions;  -- no-op where it already exists (live: public)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;  -- digest() for the gateway key

-- pg_net (push notifications) and pg_cron (retention) are optional. If they
-- cannot be enabled from SQL here, the rest still installs; verify_setup.sql
-- then says so, and README.md explains how to enable them in the dashboard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          CREATE EXTENSION IF NOT EXISTS pg_net;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'pg_net not enabled (%): push notifications stay off. Enable it under Database -> Extensions, then run schema.sql again.', SQLERRM;
        END;
      END;
    ELSE
      RAISE NOTICE 'pg_net is not available on this server: push notifications stay off.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'pg_cron not enabled (%): location history is not downsampled. Enable it under Database -> Extensions, then run schema.sql again.', SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'pg_cron is not available on this server: location history is not downsampled.';
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- 2. Enum types (created here on a new project; 00_enum_values.sql adds
--    missing values to existing ones)
-- =============================================================================

DO $$
BEGIN
  IF to_regtype('public.user_role') IS NULL THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'staff');
  END IF;
  IF to_regtype('public.collar_status') IS NULL THEN
    CREATE TYPE public.collar_status AS ENUM ('active', 'offline');
  END IF;
  IF to_regtype('public.health_status') IS NULL THEN
    CREATE TYPE public.health_status AS ENUM ('healthy', 'monitoring', 'critical');
  END IF;
  IF to_regtype('public.alert_type') IS NULL THEN
    CREATE TYPE public.alert_type AS ENUM
      ('approach_warning', 'boundary_breach', 'low_battery', 'stationary', 'info');
  END IF;
  IF to_regtype('public.alert_status') IS NULL THEN
    CREATE TYPE public.alert_status AS ENUM ('unresolved', 'resolved');
  END IF;
  IF to_regtype('public.connection_type') IS NULL THEN
    CREATE TYPE public.connection_type AS ENUM ('LTE', 'Satellite', 'LoRa');
  END IF;
  IF to_regtype('public.animal_status') IS NULL THEN
    CREATE TYPE public.animal_status AS ENUM ('grazing', 'near_boundary', 'breach', 'resting');
  END IF;

  -- An existing type without 'LoRa' means 00_enum_values.sql was not run.
  -- Stop here with a clear message instead of a confusing enum error later.
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
                 WHERE e.enumtypid = 'public.connection_type'::regtype AND e.enumlabel = 'LoRa') THEN
    RAISE EXCEPTION 'Run 00_enum_values.sql first (connection_type has no ''LoRa'' value yet), then run schema.sql again.';
  END IF;
END
$$;

-- =============================================================================
-- 3. Tables
--    CREATE TABLE IF NOT EXISTS is the shape for a new project. The ALTERs
--    after it bring an existing database to the same shape.
-- =============================================================================

-- Rebuilt in section 7; dropped first so column changes below never trip on it.
DROP VIEW IF EXISTS public.latest_livestock_locations;

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  role       public.user_role NOT NULL DEFAULT 'staff',
  farm_name  text DEFAULT 'My Farm',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collars (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_hardware_id text NOT NULL UNIQUE,
  battery_level      integer CHECK (battery_level BETWEEN 0 AND 100),  -- NULL = unknown
  status             public.collar_status NOT NULL DEFAULT 'active',
  connection_type    public.connection_type NOT NULL DEFAULT 'LoRa',
  signal_strength    text NOT NULL DEFAULT 'Good',
  firmware_version   text NOT NULL DEFAULT '1.0.0',
  last_ping_at       timestamptz,                                      -- NULL = never heard
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.livestock (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id                text NOT NULL UNIQUE,
  name                  text NOT NULL,
  breed                 text NOT NULL,
  age                   numeric(4,1),
  health_status         public.health_status NOT NULL DEFAULT 'healthy',
  animal_status         public.animal_status NOT NULL DEFAULT 'grazing',
  collar_id             uuid UNIQUE REFERENCES public.collars (id) ON DELETE SET NULL,
  training_success_rate integer DEFAULT 0 CHECK (training_success_rate BETWEEN 0 AND 100),
  audio_warning_count   integer DEFAULT 0,
  vibration_pulse_count integer DEFAULT 0,   -- stays 0: no vibration motor is fitted
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.geofences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  coordinates           geometry(Polygon, 4326) NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  warning_buffer_meters numeric(8,2) DEFAULT 30,
  created_by            uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Same shape as the live table. api_key_hash = lowercase hex SHA-256 of the
-- plaintext GATEWAY_SECRET in firmware/src/secrets.h (README.md: "Register or
-- rotate a gateway"). No policies: only ingest_telemetry() reads it.
CREATE TABLE IF NOT EXISTS public.gateways (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  api_key_hash text NOT NULL UNIQUE,
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.location_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: deleting a collar must never silently erase its history.
  collar_id   uuid NOT NULL REFERENCES public.collars (id) ON DELETE RESTRICT,
  location    geometry(Point, 4326) NOT NULL,   -- filled from longitude/latitude by a trigger
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),  -- when the fix was taken
  seq         integer,
  rssi        integer,
  snr         real,
  gateway_id  uuid REFERENCES public.gateways (id),
  sats        smallint,
  received_at timestamptz DEFAULT now()            -- when the server stored it
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collar_id    uuid REFERENCES public.collars (id) ON DELETE SET NULL,
  livestock_id uuid REFERENCES public.livestock (id) ON DELETE SET NULL,
  geofence_id  uuid REFERENCES public.geofences (id) ON DELETE SET NULL,
  alert_type   public.alert_type NOT NULL,
  status       public.alert_status NOT NULL DEFAULT 'unresolved',
  title        text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

-- Emergency Disable. One row (id = 1). Written only by set_collars_muted().
CREATE TABLE IF NOT EXISTS public.farm_settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  collars_muted_until timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

-- Expo push tokens, one row per phone. Each user sees only their own rows.
CREATE TABLE IF NOT EXISTS public.push_tokens (
  token      text PRIMARY KEY CHECK (token ~ '^Expo(nent)?PushToken\[.+\]$' AND char_length(token) <= 512),
  profile_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE CASCADE,
  platform   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- --- bring an existing database to the same shape ---------------------------

-- Neutral defaults instead of demo values.
ALTER TABLE public.profiles ALTER COLUMN farm_name SET DEFAULT 'My Farm';
ALTER TABLE public.collars  ALTER COLUMN connection_type SET DEFAULT 'LoRa';
ALTER TABLE public.collars  ALTER COLUMN last_ping_at DROP DEFAULT;
-- NULL = unknown. The v2 collar sends "unknown" until a voltage divider is fitted.
ALTER TABLE public.collars  ALTER COLUMN battery_level DROP NOT NULL;
ALTER TABLE public.collars  ALTER COLUMN battery_level DROP DEFAULT;

-- Telemetry columns (the live table already has seq/rssi/snr/gateway_id).
ALTER TABLE public.location_logs ADD COLUMN IF NOT EXISTS seq        integer;
ALTER TABLE public.location_logs ADD COLUMN IF NOT EXISTS rssi       integer;
ALTER TABLE public.location_logs ADD COLUMN IF NOT EXISTS snr        real;
ALTER TABLE public.location_logs ADD COLUMN IF NOT EXISTS gateway_id uuid REFERENCES public.gateways (id);
ALTER TABLE public.location_logs ADD COLUMN IF NOT EXISTS sats       smallint;
-- received_at: added with NO default so existing rows are not stamped with
-- today's date; back-filled from "timestamp" in section 6; default set after.
ALTER TABLE public.location_logs ADD COLUMN IF NOT EXISTS received_at timestamptz;

-- location_logs -> collars: CASCADE (live) becomes RESTRICT.
DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT conname, confdeltype FROM pg_constraint
    WHERE conrelid = 'public.location_logs'::regclass AND contype = 'f'
      AND confrelid = 'public.collars'::regclass
  LOOP
    IF v_con.confdeltype <> 'r' THEN
      EXECUTE format('ALTER TABLE public.location_logs DROP CONSTRAINT %I', v_con.conname);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.location_logs'::regclass AND contype = 'f'
                   AND confrelid = 'public.collars'::regclass) THEN
    ALTER TABLE public.location_logs
      ADD CONSTRAINT location_logs_collar_id_fkey
      FOREIGN KEY (collar_id) REFERENCES public.collars (id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- Coordinate range checks. Added NOT VALID (instant, no scan), then validated
-- in section 6 if the existing rows allow it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.location_logs'::regclass
                   AND conname = 'location_logs_latitude_range') THEN
    ALTER TABLE public.location_logs ADD CONSTRAINT location_logs_latitude_range
      CHECK (latitude BETWEEN -90 AND 90) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.location_logs'::regclass
                   AND conname = 'location_logs_longitude_range') THEN
    ALTER TABLE public.location_logs ADD CONSTRAINT location_logs_longitude_range
      CHECK (longitude BETWEEN -180 AND 180) NOT VALID;
  END IF;
END
$$;

-- =============================================================================
-- 4. Indexes (behind the app's real queries)
-- =============================================================================

-- Latest position per collar (the view), history over a time range, the
-- trigger's "newest stored fix" and stationary checks.
CREATE INDEX IF NOT EXISTS location_logs_collar_ts_idx
  ON public.location_logs (collar_id, "timestamp" DESC);
-- De-duplication of re-sent readings (ON CONFLICT target, and the (collar_id,
-- seq) lookup for readings without a GPS time). Exists on the live database.
CREATE UNIQUE INDEX IF NOT EXISTS location_logs_dedupe
  ON public.location_logs (collar_id, seq, "timestamp");
CREATE INDEX IF NOT EXISTS location_logs_location_idx
  ON public.location_logs USING gist (location);
CREATE INDEX IF NOT EXISTS geofences_coordinates_idx
  ON public.geofences USING gist (coordinates);
-- Active alerts list (status, newest first).
CREATE INDEX IF NOT EXISTS alerts_status_created_idx
  ON public.alerts (status, created_at DESC);
-- The trigger's "open alert of this type for this animal" lookups.
CREATE INDEX IF NOT EXISTS alerts_livestock_type_status_idx
  ON public.alerts (livestock_id, alert_type, status);
CREATE INDEX IF NOT EXISTS push_tokens_profile_id_idx
  ON public.push_tokens (profile_id);

-- =============================================================================
-- 5. Functions
--    Every function pins its search_path. SECURITY DEFINER is used only where
--    a caller must do something its own role may not (the gateway writing as
--    anon, triggers writing alerts); each of those checks its caller itself.
-- =============================================================================

-- --- helpers used by RLS policies ------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- --- sign-up: every new account is staff ------------------------------------
-- The role is never taken from sign-up metadata: that metadata is written by
-- the person signing up. Admins are made by hand (README.md).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    left(COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
                  NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
                  'New user'), 200),
    'staff')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- --- small trigger functions ------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- PostGIS order is (longitude, latitude).
CREATE OR REPLACE FUNCTION public.sync_location_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  RETURN NEW;
END;
$$;

-- Resolving an alert: the database stamps who and when. A signed-in user can
-- only change status/resolved_at/resolved_by (column grants, section 10),
-- and cannot put someone else's name on it. auth.uid() is NULL when the
-- server resolves an alert itself, so resolved_by stays NULL then.
CREATE OR REPLACE FUNCTION public.alerts_set_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.status = 'resolved' THEN
    IF OLD.status = 'resolved' THEN
      NEW.resolved_at := OLD.resolved_at;
      NEW.resolved_by := OLD.resolved_by;
    ELSE
      NEW.resolved_at := now();
      NEW.resolved_by := auth.uid();
    END IF;
  ELSE
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- --- the fence decision -------------------------------------------------------
-- Runs after every location_logs insert. Contract v2, identical to
-- evaluateAgainstFences() in app/src/lib/utils.ts:
--   breach        outside every active fence, at any distance
--   near_boundary inside, within that fence's warning buffer of its edge,
--                 judged on the fence the point is deepest inside
--   no active fences -> grazing
--   hysteresis: leaving breach needs >= 3 m depth (then near_boundary if in
--   the buffer, else grazing); near_boundary -> grazing needs depth > buffer+3
--   resting is never overwritten by grazing
-- Alerts are written only on a state change; leaving a state resolves that
-- state's open alert. Readings older than the newest stored fix are kept but
-- do not change anything (a buffered burst arrives out of order).

CREATE OR REPLACE FUNCTION public.detect_geofence_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c_hysteresis_m      CONSTANT double precision := 3;
  c_stationary_m      CONSTANT double precision := 15;
  c_stationary_window CONSTANT interval := interval '60 minutes';
  v_animal     record;
  v_fence      record;
  v_prev_ts    timestamptz;
  v_prev       public.animal_status;
  v_new        public.animal_status;
  v_fence_id   uuid;
  v_fence_name text;
  v_outside_m  double precision;
  v_history    boolean;
  v_open       boolean;
  v_moved      boolean;
BEGIN
  -- Locked so two uploads for the same animal cannot interleave.
  SELECT l.id, l.name, l.animal_status INTO v_animal
  FROM public.livestock l
  WHERE l.collar_id = NEW.collar_id
  LIMIT 1
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;   -- collar not paired to an animal: position kept, no fence state
  END IF;

  SELECT ll."timestamp" INTO v_prev_ts
  FROM public.location_logs ll
  WHERE ll.collar_id = NEW.collar_id AND ll.id <> NEW.id
  ORDER BY ll."timestamp" DESC
  LIMIT 1;

  IF v_prev_ts IS NOT NULL AND NEW."timestamp" < v_prev_ts THEN
    RETURN NEW;   -- out of order
  END IF;

  v_prev := v_animal.animal_status;

  -- The active fence the point is deepest inside (depth = metres to its edge).
  SELECT g.id, g.name,
         COALESCE(g.warning_buffer_meters, 30)::double precision AS buffer_m,
         ST_Distance(NEW.location::geography, ST_Boundary(g.coordinates)::geography) AS depth_m
    INTO v_fence
  FROM public.geofences g
  WHERE g.is_active AND ST_Covers(g.coordinates, NEW.location)
  ORDER BY depth_m DESC
  LIMIT 1;

  IF FOUND THEN
    v_fence_id := v_fence.id;
    v_fence_name := v_fence.name;
    IF v_prev = 'breach' AND v_fence.depth_m < c_hysteresis_m THEN
      v_new := 'breach';
    ELSIF v_prev = 'near_boundary' THEN
      v_new := CASE WHEN v_fence.depth_m > v_fence.buffer_m + c_hysteresis_m
                    THEN 'grazing' ELSE 'near_boundary' END;
    ELSE
      v_new := CASE WHEN v_fence.depth_m <= v_fence.buffer_m
                    THEN 'near_boundary' ELSE 'grazing' END;
    END IF;
  ELSE
    SELECT g.id, g.name,
           ST_Distance(g.coordinates::geography, NEW.location::geography) AS dist_m
      INTO v_fence
    FROM public.geofences g
    WHERE g.is_active
    ORDER BY dist_m
    LIMIT 1;
    IF FOUND THEN
      v_new := 'breach';
      v_fence_id := v_fence.id;
      v_fence_name := v_fence.name;
      v_outside_m := v_fence.dist_m;
    ELSE
      v_new := 'grazing';   -- no active fences: safe
    END IF;
  END IF;

  IF v_new = 'grazing' AND v_prev = 'resting' THEN
    v_new := 'resting';
  END IF;

  IF v_new IS DISTINCT FROM v_prev THEN
    UPDATE public.livestock
    SET animal_status = v_new,
        audio_warning_count = CASE WHEN v_new IN ('near_boundary', 'breach')
                                   THEN COALESCE(audio_warning_count, 0) + 1
                                   ELSE audio_warning_count END
    WHERE id = v_animal.id;

    IF v_new = 'breach' THEN
      INSERT INTO public.alerts (collar_id, livestock_id, geofence_id, alert_type, title, description)
      VALUES (NEW.collar_id, v_animal.id, v_fence_id, 'boundary_breach',
              v_fence_name || ' Breach Detected',
              format('%s is outside every fence, %s m from %s',
                     v_animal.name, round(v_outside_m::numeric), v_fence_name));
    ELSIF v_new = 'near_boundary' THEN
      INSERT INTO public.alerts (collar_id, livestock_id, geofence_id, alert_type, title, description)
      VALUES (NEW.collar_id, v_animal.id, v_fence_id, 'approach_warning',
              'Near Boundary',
              format('%s is %s m from the edge of %s',
                     v_animal.name, round(v_fence.depth_m::numeric), v_fence_name));
    END IF;
  END IF;

  -- Leaving a state closes its open alert. Checked on every in-order fix, so
  -- alerts left open by older versions are closed on the next position too.
  IF v_new <> 'breach' THEN
    UPDATE public.alerts SET status = 'resolved'
    WHERE livestock_id = v_animal.id AND alert_type = 'boundary_breach' AND status = 'unresolved';
  END IF;
  IF v_new <> 'near_boundary' THEN
    UPDATE public.alerts SET status = 'resolved'
    WHERE livestock_id = v_animal.id AND alert_type = 'approach_warning' AND status = 'unresolved';
  END IF;

  -- Stationary: moved less than 15 m in 60 minutes. Evaluated at most once
  -- per minute of fix time (the window scan is the costly part).
  IF v_prev_ts IS NULL OR date_trunc('minute', NEW."timestamp") <> date_trunc('minute', v_prev_ts) THEN
    -- Tracked for the whole hour? (a fix 60-65 minutes ago)
    v_history := EXISTS (
      SELECT 1 FROM public.location_logs ll
      WHERE ll.collar_id = NEW.collar_id
        AND ll."timestamp" BETWEEN NEW."timestamp" - c_stationary_window - interval '5 minutes'
                               AND NEW."timestamp" - c_stationary_window);
    v_open := EXISTS (
      SELECT 1 FROM public.alerts a
      WHERE a.livestock_id = v_animal.id AND a.alert_type = 'stationary' AND a.status = 'unresolved');
    IF v_history OR v_open THEN
      v_moved := EXISTS (
        SELECT 1 FROM public.location_logs ll
        WHERE ll.collar_id = NEW.collar_id
          AND ll."timestamp" BETWEEN NEW."timestamp" - c_stationary_window AND NEW."timestamp"
          AND NOT ST_DWithin(ll.location::geography, NEW.location::geography, c_stationary_m));
      IF v_moved AND v_open THEN
        UPDATE public.alerts SET status = 'resolved'
        WHERE livestock_id = v_animal.id AND alert_type = 'stationary' AND status = 'unresolved';
      ELSIF NOT v_moved AND v_history AND NOT v_open THEN
        INSERT INTO public.alerts (collar_id, livestock_id, alert_type, title, description)
        VALUES (NEW.collar_id, v_animal.id, 'stationary', 'Not Moving',
                format('%s has moved less than %s m in the last 60 minutes',
                       v_animal.name, c_stationary_m::int));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- --- gateway ingest (contract v2) -------------------------------------------
-- POST /rest/v1/rpc/ingest_telemetry with the anon key. p_gateway_key is the
-- real authentication, checked against gateways.api_key_hash.
--
-- in   p_readings: [{device_id, seq, ts, fix, lat, lng, battery, rssi, snr,
--                    sats, gps_ok, gps_restarted, age_ms}, ...]  oldest first
--      ts 0 = unknown; lat/lng/battery may be null; sats, gps_ok,
--      gps_restarted and age_ms are optional (a v1 gateway omits them).
-- out  bare JSON array, one element per device in the batch:
--      [{"device_id": "FT-...", "seq": <that device's newest seq>, "state": 0|1|2}]
--      state is 0 (SAFE) when the farm is muted, when the newest reading has
--      no usable fix, or when the collar's newest stored fix is > 60 s old.
--
-- Each reading is processed in its own sub-transaction: one bad reading is
-- skipped (logged as a WARNING in the Postgres logs), the rest are stored.
-- Unknown FT-XXXXXXXX collars are registered on first contact and appear
-- unpaired in the app's Hardware tab.

CREATE OR REPLACE FUNCTION public.ingest_telemetry(p_gateway_key text, p_readings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c_min_epoch       CONSTANT numeric  := 1704067200;          -- 2024-01-01 UTC
  c_max_readings    CONSTANT integer  := 1000;
  c_dedupe_window   CONSTANT interval := interval '120 seconds';
  c_dedupe_slack    CONSTANT interval := interval '10 seconds';
  c_stale_fix       CONSTANT interval := interval '60 seconds';
  v_now      timestamptz := now();
  v_gateway  uuid;
  v_muted    boolean;
  r          jsonb;
  v_ord      bigint;
  v_device   text;
  v_seq      integer;
  v_fix      boolean;
  v_lat      double precision;
  v_lng      double precision;
  v_ts       numeric;
  v_age_ms   numeric;
  v_time     timestamptz;
  v_server_clock boolean;
  v_collar   uuid;
  v_battery  integer;
  v_rssi     integer;
  v_devices  jsonb := '{}'::jsonb;   -- device_id -> its newest reading's summary
  v_entry    jsonb;
  v_status   public.animal_status;
  v_latest   timestamptz;
  v_state    integer;
  v_results  jsonb := '[]'::jsonb;
BEGIN
  IF p_gateway_key IS NULL OR p_gateway_key = '' THEN
    RAISE EXCEPTION 'invalid gateway key' USING ERRCODE = '28000';
  END IF;
  SELECT g.id INTO v_gateway
  FROM public.gateways g
  WHERE g.api_key_hash = encode(digest(p_gateway_key, 'sha256'), 'hex');
  IF v_gateway IS NULL THEN
    RAISE EXCEPTION 'invalid gateway key' USING ERRCODE = '28000';   -- HTTP 403
  END IF;

  IF p_readings IS NULL OR jsonb_typeof(p_readings) <> 'array' THEN
    RAISE EXCEPTION 'p_readings must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_readings) > c_max_readings THEN
    RAISE EXCEPTION 'at most % readings per call', c_max_readings USING ERRCODE = '22023';
  END IF;

  UPDATE public.gateways SET last_seen_at = v_now WHERE id = v_gateway;

  -- ---- pass 1: store every reading, oldest first --------------------------
  FOR r, v_ord IN
    SELECT e.value, e.ordinality
    FROM jsonb_array_elements(p_readings) WITH ORDINALITY AS e(value, ordinality)
    ORDER BY e.ordinality
  LOOP
    v_device := NULL;
    v_seq := NULL;
    BEGIN
      IF jsonb_typeof(r) IS DISTINCT FROM 'object'
         OR jsonb_typeof(r -> 'device_id') IS DISTINCT FROM 'string' THEN
        RAISE WARNING 'ingest_telemetry: reading % has no device_id - skipped', v_ord;
        CONTINUE;
      END IF;
      v_device := btrim(r ->> 'device_id');
      IF v_device !~ '^FT-[0-9A-F]{8}$'
         AND NOT EXISTS (SELECT 1 FROM public.collars c WHERE c.device_hardware_id = v_device) THEN
        RAISE WARNING 'ingest_telemetry: reading % device_id "%" is not FT-XXXXXXXX - skipped', v_ord, left(v_device, 40);
        CONTINUE;
      END IF;
      v_seq := CASE WHEN jsonb_typeof(r -> 'seq') = 'number'
                     AND (r ->> 'seq')::numeric BETWEEN 0 AND 65535
                    THEN (r ->> 'seq')::numeric::integer END;

      -- Recorded before anything can fail: if the rest of this reading
      -- errors, the device is still answered, with SAFE (fail-silent).
      v_devices := jsonb_set(v_devices, ARRAY[v_device], jsonb_build_object(
        'first_ord', COALESCE(v_devices -> v_device -> 'first_ord', to_jsonb(v_ord)),
        'seq', v_seq, 'fix', false, 'collar', NULL, 'age_ms', 0,
        'battery_present', false, 'battery', NULL, 'rssi', NULL));

      v_fix := CASE jsonb_typeof(r -> 'fix')
                 WHEN 'boolean' THEN (r ->> 'fix')::boolean
                 WHEN 'number'  THEN (r ->> 'fix')::numeric <> 0
                 ELSE false END;
      v_lat := CASE WHEN jsonb_typeof(r -> 'lat') = 'number' THEN (r ->> 'lat')::double precision END;
      v_lng := CASE WHEN jsonb_typeof(r -> 'lng') = 'number' THEN (r ->> 'lng')::double precision END;
      IF v_fix AND (v_lat IS NULL OR v_lng IS NULL
                    OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180
                    OR (v_lat = 0 AND v_lng = 0)) THEN
        RAISE WARNING 'ingest_telemetry: % seq % fix=true with unusable position (%, %) - treated as no fix',
                      v_device, v_seq, v_lat, v_lng;
        v_fix := false;
      END IF;

      -- Fix time: the collar's GPS time when plausible, else the moment the
      -- gateway heard it (server clock minus how long the gateway held it).
      v_age_ms := CASE WHEN jsonb_typeof(r -> 'age_ms') = 'number'
                       THEN LEAST(GREATEST((r ->> 'age_ms')::numeric, 0), 604800000) ELSE 0 END;
      v_ts := CASE WHEN jsonb_typeof(r -> 'ts') = 'number' THEN (r ->> 'ts')::numeric END;
      IF v_ts IS NOT NULL AND v_ts >= c_min_epoch AND v_ts <= extract(epoch FROM v_now) + 30 THEN
        v_time := to_timestamp(v_ts::double precision);
        v_server_clock := false;
      ELSE
        v_time := v_now - (v_age_ms::double precision * interval '1 millisecond');
        v_server_clock := true;
      END IF;

      v_battery := CASE WHEN jsonb_typeof(r -> 'battery') = 'number'
                         AND (r ->> 'battery')::numeric BETWEEN 0 AND 100
                        THEN round((r ->> 'battery')::numeric)::integer END;  -- 255 / null = unknown
      v_rssi := CASE WHEN jsonb_typeof(r -> 'rssi') = 'number'
                     THEN round((r ->> 'rssi')::numeric)::integer END;

      -- Collar row, locked so concurrent uploads of the same collar serialise.
      SELECT c.id INTO v_collar FROM public.collars c
      WHERE c.device_hardware_id = v_device FOR NO KEY UPDATE;
      IF v_collar IS NULL THEN
        INSERT INTO public.collars (device_hardware_id, connection_type, signal_strength)
        VALUES (v_device, 'LoRa', 'Good')
        ON CONFLICT (device_hardware_id) DO NOTHING
        RETURNING id INTO v_collar;
        IF v_collar IS NULL THEN
          SELECT c.id INTO v_collar FROM public.collars c
          WHERE c.device_hardware_id = v_device FOR NO KEY UPDATE;
        END IF;
      END IF;

      IF v_fix THEN
        -- A retried batch re-sends a ts=0 reading with a different age_ms, so
        -- its computed time moves by the network jitter. Treat it as the same
        -- reading when the same collar+seq was stored in the last 120 s with
        -- a fix time within 10 s. (The 10 s keeps a collar that rebooted and
        -- restarted its seq from being mistaken for a retry.)
        IF v_server_clock AND v_seq IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.location_logs ll
             WHERE ll.collar_id = v_collar AND ll.seq = v_seq
               AND ll.received_at >= v_now - c_dedupe_window
               AND ll."timestamp" BETWEEN v_time - c_dedupe_slack AND v_time + c_dedupe_slack) THEN
          NULL;   -- duplicate
        ELSE
          -- The AFTER INSERT trigger decides the fence state here.
          INSERT INTO public.location_logs
            (collar_id, latitude, longitude, "timestamp", received_at, seq, rssi, snr, sats, gateway_id)
          VALUES
            (v_collar, v_lat, v_lng, v_time, v_now, v_seq, v_rssi,
             CASE WHEN jsonb_typeof(r -> 'snr') = 'number' THEN (r ->> 'snr')::real END,
             CASE WHEN jsonb_typeof(r -> 'sats') = 'number' AND (r ->> 'sats')::numeric BETWEEN 0 AND 31
                  THEN (r ->> 'sats')::numeric::smallint END,
             v_gateway)
          ON CONFLICT (collar_id, seq, "timestamp") DO NOTHING;   -- duplicate with the same GPS time
        END IF;
      END IF;

      v_devices := jsonb_set(v_devices, ARRAY[v_device], (v_devices -> v_device) || jsonb_build_object(
        'collar', v_collar, 'fix', v_fix, 'age_ms', v_age_ms,
        'battery_present', r ? 'battery', 'battery', v_battery, 'rssi', v_rssi));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ingest_telemetry: reading % (% seq %) skipped: % [%]',
                    v_ord, v_device, v_seq, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- ---- pass 2: per device, from its newest reading -------------------------
  v_muted := COALESCE((SELECT fs.collars_muted_until > v_now
                       FROM public.farm_settings fs WHERE fs.id = 1), false);

  FOR v_device, v_entry IN
    SELECT d.key, d.value FROM jsonb_each(v_devices) AS d(key, value)
    ORDER BY (d.value ->> 'first_ord')::bigint
  LOOP
    v_state := 0;
    BEGIN
      v_collar := (v_entry ->> 'collar')::uuid;
      IF v_collar IS NULL THEN
        SELECT c.id INTO v_collar FROM public.collars c WHERE c.device_hardware_id = v_device;
      END IF;

      IF v_collar IS NOT NULL THEN
        v_battery := (v_entry ->> 'battery')::integer;
        v_rssi := (v_entry ->> 'rssi')::integer;

        -- last_ping_at = when the gateway heard it, not when WiFi came back.
        UPDATE public.collars
        SET last_ping_at = GREATEST(COALESCE(last_ping_at, '-infinity'::timestamptz),
                                    v_now - ((v_entry ->> 'age_ms')::double precision * interval '1 millisecond')),
            status = 'active',
            connection_type = 'LoRa',
            battery_level = CASE WHEN (v_entry ->> 'battery_present')::boolean
                                 THEN v_battery ELSE battery_level END,
            signal_strength = CASE WHEN v_rssi IS NULL THEN signal_strength
                                   WHEN v_rssi > -90  THEN 'Good'
                                   WHEN v_rssi > -110 THEN 'Fair'
                                   ELSE 'Weak' END
        WHERE id = v_collar;

        -- Low battery: open below 20 %, resolved at 30 % or more.
        IF v_battery IS NOT NULL THEN
          IF v_battery < 20 THEN
            INSERT INTO public.alerts (collar_id, livestock_id, alert_type, title, description)
            SELECT v_collar,
                   (SELECT l.id FROM public.livestock l WHERE l.collar_id = v_collar LIMIT 1),
                   'low_battery', 'Low Collar Battery',
                   format('%s is at %s%%', v_device, v_battery)
            WHERE NOT EXISTS (SELECT 1 FROM public.alerts a
                              WHERE a.collar_id = v_collar AND a.alert_type = 'low_battery'
                                AND a.status = 'unresolved');
          ELSIF v_battery >= 30 THEN
            UPDATE public.alerts SET status = 'resolved'
            WHERE collar_id = v_collar AND alert_type = 'low_battery' AND status = 'unresolved';
          END IF;
        END IF;

        IF NOT v_muted AND (v_entry ->> 'fix')::boolean THEN
          SELECT max(ll."timestamp") INTO v_latest
          FROM public.location_logs ll WHERE ll.collar_id = v_collar;
          IF v_latest >= v_now - c_stale_fix THEN
            SELECT l.animal_status INTO v_status
            FROM public.livestock l WHERE l.collar_id = v_collar LIMIT 1;
            v_state := CASE v_status WHEN 'breach' THEN 2 WHEN 'near_boundary' THEN 1 ELSE 0 END;
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_state := 0;
      RAISE WARNING 'ingest_telemetry: state for % failed, answering SAFE: % [%]', v_device, SQLERRM, SQLSTATE;
    END;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'device_id', v_device, 'seq', v_entry -> 'seq', 'state', v_state));
  END LOOP;

  RETURN v_results;
END;
$$;

-- --- fences -----------------------------------------------------------------

-- Output shape unchanged. SECURITY INVOKER: RLS on geofences decides.
CREATE OR REPLACE FUNCTION public.get_geofences_geojson()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'is_active', g.is_active,
        'warning_buffer_meters', g.warning_buffer_meters,
        'created_by', g.created_by,
        'coordinates', ST_AsGeoJSON(g.coordinates)::jsonb
      ) ORDER BY g.created_at, g.id
    ),
    '[]'::jsonb)
  FROM public.geofences g;
$$;

-- Admin only. p_ring is [[lng, lat], ...]; it is closed automatically if the
-- last point is not the first. On an update, NULL keeps the existing value.
-- On an insert, is_active defaults to true and the buffer to 30 m.
CREATE OR REPLACE FUNCTION public.upsert_geofence(
  p_id uuid,
  p_name text,
  p_ring jsonb,
  p_is_active boolean DEFAULT NULL,
  p_warning_buffer_meters numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id   uuid;
  v_ring jsonb := p_ring;
  v_geom geometry;
  v_bad  integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can manage geofences' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NOT NULL AND btrim(p_name) = '' THEN
    RAISE EXCEPTION 'The fence needs a name' USING ERRCODE = '22023';
  END IF;
  IF p_warning_buffer_meters IS NOT NULL
     AND (p_warning_buffer_meters < 0 OR p_warning_buffer_meters > 10000) THEN
    RAISE EXCEPTION 'Warning distance must be between 0 and 10000 m' USING ERRCODE = '22023';
  END IF;

  IF v_ring IS NOT NULL THEN
    IF jsonb_typeof(v_ring) <> 'array' THEN
      RAISE EXCEPTION 'p_ring must be an array of [longitude, latitude] points' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_ring) AS pt
    WHERE NOT CASE WHEN jsonb_typeof(pt) = 'array'
                        AND jsonb_typeof(pt -> 0) = 'number'
                        AND jsonb_typeof(pt -> 1) = 'number'
                   THEN (pt ->> 0)::double precision BETWEEN -180 AND 180
                        AND (pt ->> 1)::double precision BETWEEN -90 AND 90
                   ELSE false END;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Every fence point must be [longitude, latitude] within range' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_ring) > 0
       AND ((v_ring -> 0 ->> 0)::double precision <> (v_ring -> -1 ->> 0)::double precision
         OR (v_ring -> 0 ->> 1)::double precision <> (v_ring -> -1 ->> 1)::double precision) THEN
      v_ring := v_ring || jsonb_build_array(v_ring -> 0);
    END IF;
    IF jsonb_array_length(v_ring) < 4 THEN
      RAISE EXCEPTION 'A fence needs at least 3 corners' USING ERRCODE = '22023';
    END IF;

    SELECT ST_SetSRID(
             ST_MakePolygon(
               ST_MakeLine(ST_MakePoint((e.pt ->> 0)::double precision, (e.pt ->> 1)::double precision)
                           ORDER BY e.ord)),
             4326)
      INTO v_geom
    FROM jsonb_array_elements(v_ring) WITH ORDINALITY AS e(pt, ord);

    IF NOT ST_IsValid(v_geom) THEN
      RAISE EXCEPTION 'The fence outline is not a valid polygon (%)', ST_IsValidReason(v_geom)
        USING ERRCODE = '22023', HINT = 'Edges must not cross each other.';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR v_geom IS NULL THEN
      RAISE EXCEPTION 'A new fence needs a name and an outline' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.geofences (name, coordinates, is_active, warning_buffer_meters, created_by)
    VALUES (btrim(p_name), v_geom, COALESCE(p_is_active, true),
            COALESCE(p_warning_buffer_meters, 30), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.geofences
    SET name                  = COALESCE(btrim(p_name), name),
        coordinates           = COALESCE(v_geom, coordinates),
        is_active             = COALESCE(p_is_active, is_active),
        warning_buffer_meters = COALESCE(p_warning_buffer_meters, warning_buffer_meters)
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Fence % not found', p_id USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- --- Emergency Disable --------------------------------------------------------
-- Any signed-in user may silence the collar buzzers (a safety control).
-- p_minutes > 0 mutes until now + p_minutes (at most 24 h); <= 0 unmutes and
-- returns NULL. Alerts in the app keep working while muted.

CREATE OR REPLACE FUNCTION public.set_collars_muted(p_minutes integer)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to mute the collars' USING ERRCODE = '42501';
  END IF;
  IF p_minutes IS NULL THEN
    RAISE EXCEPTION 'p_minutes is required (0 unmutes)' USING ERRCODE = '22004';
  END IF;
  IF p_minutes > 1440 THEN
    RAISE EXCEPTION 'Collars can be muted for at most 1440 minutes (24 hours)' USING ERRCODE = '22023';
  END IF;

  v_until := CASE WHEN p_minutes > 0 THEN now() + make_interval(mins => p_minutes) END;

  INSERT INTO public.farm_settings (id, collars_muted_until, updated_at, updated_by)
  VALUES (1, v_until, now(), v_uid)
  ON CONFLICT (id) DO UPDATE
    SET collars_muted_until = EXCLUDED.collars_muted_until,
        updated_at          = EXCLUDED.updated_at,
        updated_by          = EXCLUDED.updated_by;
  RETURN v_until;
END;
$$;

-- --- push notifications -------------------------------------------------------

-- Upsert this phone's Expo token for the signed-in user. A phone that changes
-- user takes its token over (a direct upsert cannot: RLS hides the old row).
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to register for notifications' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR char_length(p_token) > 512 OR p_token !~ '^Expo(nent)?PushToken\[.+\]$' THEN
    RAISE EXCEPTION 'Not an Expo push token' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_tokens (token, profile_id, platform)
  VALUES (p_token, v_uid, left(p_platform, 20))
  ON CONFLICT (token) DO UPDATE
    SET profile_id = EXCLUDED.profile_id,
        platform   = EXCLUDED.platform,
        updated_at = now();
END;
$$;

-- After an alert is inserted: queue one Expo push to every registered phone.
-- Breach -> Android channel "alarms"; low battery / stationary -> "alerts".
-- pg_net sends only after the transaction commits, and nothing here can make
-- the reading's transaction fail: any error becomes a WARNING in the logs.
CREATE OR REPLACE FUNCTION public.notify_alert_push()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_messages jsonb;
BEGIN
  IF NEW.alert_type NOT IN ('boundary_breach', 'low_battery', 'stationary')
     OR NEW.status <> 'unresolved' THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
      RETURN NEW;   -- pg_net not installed: pushes are off
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
             'to', t.token,
             'title', NEW.title,
             'body', COALESCE(NEW.description, ''),
             'sound', 'default',
             'priority', 'high',
             'channelId', CASE WHEN NEW.alert_type = 'boundary_breach' THEN 'alarms' ELSE 'alerts' END,
             'data', jsonb_build_object('alert_id', NEW.id,
                                        'alert_type', NEW.alert_type,
                                        'livestock_id', NEW.livestock_id)))
      INTO v_messages
    FROM (SELECT pt.token FROM public.push_tokens pt
          ORDER BY pt.updated_at DESC LIMIT 100) t;   -- Expo takes up to 100 per request

    IF v_messages IS NOT NULL THEN
      PERFORM net.http_post(
        url                  := 'https://exp.host/--/api/v2/push/send',
        body                 := v_messages,
        params               := '{}'::jsonb,
        headers              := jsonb_build_object('Content-Type', 'application/json',
                                                   'Accept', 'application/json'),
        timeout_milliseconds := 5000);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_alert_push: push for alert % not queued: % [%]', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- --- retention ------------------------------------------------------------------
-- Raw fixes are kept for 30 days; older ones are thinned to the first fix of
-- each minute per collar. Returns the number of rows deleted. Run daily by
-- pg_cron (section 9); not callable through the API.
CREATE OR REPLACE FUNCTION public.downsample_location_logs()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  WITH ranked AS (
    SELECT ll.id,
           row_number() OVER (PARTITION BY ll.collar_id, date_trunc('minute', ll."timestamp")
                              ORDER BY ll."timestamp", ll.id) AS rn
    FROM public.location_logs ll
    WHERE ll."timestamp" < now() - interval '30 days'
  )
  DELETE FROM public.location_logs d
  USING ranked
  WHERE d.id = ranked.id AND ranked.rn > 1;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- --- API guard for PostGIS system tables -------------------------------------
-- spatial_ref_sys (owned by supabase_admin) is writable by anon, and this
-- project's postgres role can neither revoke that nor enable RLS on it.
-- Deleting SRID 4326 through the REST API would break every ::geography cast
-- in the fence trigger. PostgREST calls this function before every request
-- (pgrst.db_pre_request, section 9) as the request's role; it refuses the
-- PostGIS system tables and the GraphQL endpoint (which the app does not use,
-- and which exposes the same tables) for anon and authenticated.
CREATE OR REPLACE FUNCTION public.farmtrack_pre_request()
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_path text := lower(COALESCE(current_setting('request.path', true), ''));
BEGIN
  -- A '%' means a percent-encoded path (spatial%5Fref%5Fsys): PostgREST
  -- decodes it before resolving the table, so match it by refusing any
  -- encoded path. The app and the gateway never send one.
  IF current_user IN ('anon', 'authenticated')
     AND (strpos(v_path, '%') > 0
          OR v_path ~ '^/*(spatial_ref_sys|geometry_columns|geography_columns|rpc/graphql)([/?]|$)') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- =============================================================================
-- 6. Triggers, back-fill, constraint validation
-- =============================================================================

-- Sign-up trigger. Created only if missing: the live one is already correct,
-- and the auth.users trigger is never dropped or replaced.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users not found - sign-up trigger not created';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'auth.users'::regclass
                      AND tgname = 'on_auth_user_created' AND NOT tgisinternal) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$$;

CREATE OR REPLACE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER collars_updated_at BEFORE UPDATE ON public.collars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER livestock_updated_at BEFORE UPDATE ON public.livestock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER geofences_updated_at BEFORE UPDATE ON public.geofences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER push_tokens_updated_at BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Only when a coordinate changes (moving rows to another collar, or the
-- back-fill below, does not need the point rebuilt).
CREATE OR REPLACE TRIGGER location_logs_sync_point
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.location_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_location_point();
CREATE OR REPLACE TRIGGER location_logs_detect_events
  AFTER INSERT ON public.location_logs
  FOR EACH ROW EXECUTE FUNCTION public.detect_geofence_events();

CREATE OR REPLACE TRIGGER alerts_set_resolution
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.alerts_set_resolution();
CREATE OR REPLACE TRIGGER alerts_push_notify
  AFTER INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.notify_alert_push();

-- Any other trigger on these two tables is not part of this design.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, c.relname
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('location_logs', 'alerts')
      AND NOT tg.tgisinternal
      AND tg.tgname NOT IN ('location_logs_sync_point', 'location_logs_detect_events',
                            'alerts_set_resolution', 'alerts_push_notify')
  LOOP
    RAISE NOTICE 'dropping unexpected trigger % on %', t.tgname, t.relname;
    EXECUTE format('DROP TRIGGER %I ON public.%I', t.tgname, t.relname);
  END LOOP;
END
$$;

-- A disabled fence trigger would silently stop every alert.
ALTER TABLE public.location_logs ENABLE TRIGGER location_logs_detect_events;
ALTER TABLE public.location_logs ENABLE TRIGGER location_logs_sync_point;

-- received_at for rows stored before this version: the old rows' "timestamp"
-- was the upload time, so it is the best receipt time there is.
UPDATE public.location_logs SET received_at = "timestamp" WHERE received_at IS NULL;
ALTER TABLE public.location_logs ALTER COLUMN received_at SET DEFAULT now();

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.location_logs VALIDATE CONSTRAINT location_logs_latitude_range;
    ALTER TABLE public.location_logs VALIDATE CONSTRAINT location_logs_longitude_range;
  EXCEPTION WHEN check_violation THEN
    RAISE WARNING 'location_logs has out-of-range coordinates; the range checks stay NOT VALID (they still apply to new rows).';
  END;
END
$$;

-- =============================================================================
-- 7. View: latest position per animal
--    The collar's newest fix, without averaging away movement;
--    last_seen_at = newest fix, last_ping_at = last time the collar was heard
--    at all, sats = satellites in the newest fix. security_invoker: the
--    caller's own RLS applies, so anon sees nothing.
-- =============================================================================

CREATE VIEW public.latest_livestock_locations
WITH (security_invoker = true)
AS
SELECT l.id              AS livestock_id,
       l.tag_id,
       l.name,
       l.breed,
       l.animal_status,
       l.health_status,
       c.id              AS collar_id,
       c.device_hardware_id,
       c.battery_level,
       c.status          AS collar_status,
       c.connection_type,
       f.latitude,
       f.longitude,
       f.last_seen_at,
       c.last_ping_at,
       f.sats
FROM public.livestock l
LEFT JOIN public.collars c ON c.id = l.collar_id
LEFT JOIN LATERAL (
  SELECT ll.latitude,
         ll.longitude,
         ll."timestamp" AS last_seen_at,
         ll.sats
  FROM public.location_logs ll
  WHERE ll.collar_id = c.id
  ORDER BY ll."timestamp" DESC, ll.received_at DESC NULLS LAST, ll.id DESC
  LIMIT 1
) f ON true;

-- =============================================================================
-- 8. Row level security
-- =============================================================================

ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collars       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livestock     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateways      ENABLE ROW LEVEL SECURITY;   -- no policies: API cannot touch it
ALTER TABLE public.location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens   ENABLE ROW LEVEL SECURITY;

-- profiles (which columns can change is limited by grants in section 10)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- collars: everyone signed in reads, admins write
DROP POLICY IF EXISTS "Authenticated users can view collars" ON public.collars;
CREATE POLICY "Authenticated users can view collars" ON public.collars
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert collars" ON public.collars;
CREATE POLICY "Admins can insert collars" ON public.collars
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update collars" ON public.collars;
CREATE POLICY "Admins can update collars" ON public.collars
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete collars" ON public.collars;
CREATE POLICY "Admins can delete collars" ON public.collars
  FOR DELETE TO authenticated USING (public.is_admin());

-- livestock
DROP POLICY IF EXISTS "Authenticated users can view livestock" ON public.livestock;
CREATE POLICY "Authenticated users can view livestock" ON public.livestock
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert livestock" ON public.livestock;
CREATE POLICY "Admins can insert livestock" ON public.livestock
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update livestock" ON public.livestock;
CREATE POLICY "Admins can update livestock" ON public.livestock
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete livestock" ON public.livestock;
CREATE POLICY "Admins can delete livestock" ON public.livestock
  FOR DELETE TO authenticated USING (public.is_admin());

-- geofences
DROP POLICY IF EXISTS "Authenticated users can view geofences" ON public.geofences;
CREATE POLICY "Authenticated users can view geofences" ON public.geofences
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert geofences" ON public.geofences;
CREATE POLICY "Admins can insert geofences" ON public.geofences
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update geofences" ON public.geofences;
CREATE POLICY "Admins can update geofences" ON public.geofences
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete geofences" ON public.geofences;
CREATE POLICY "Admins can delete geofences" ON public.geofences
  FOR DELETE TO authenticated USING (public.is_admin());

-- location_logs: the gateway writes through ingest_telemetry(), not the API
DROP POLICY IF EXISTS "Authenticated users can view location logs" ON public.location_logs;
CREATE POLICY "Authenticated users can view location logs" ON public.location_logs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert location logs" ON public.location_logs;
CREATE POLICY "Admins can insert location logs" ON public.location_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- alerts: everyone signed in reads and resolves (only the resolution columns)
DROP POLICY IF EXISTS "Authenticated users can view alerts" ON public.alerts;
CREATE POLICY "Authenticated users can view alerts" ON public.alerts
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can resolve alerts" ON public.alerts;
CREATE POLICY "Authenticated users can resolve alerts" ON public.alerts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can insert alerts" ON public.alerts;
CREATE POLICY "Admins can insert alerts" ON public.alerts
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete alerts" ON public.alerts;
CREATE POLICY "Admins can delete alerts" ON public.alerts
  FOR DELETE TO authenticated USING (public.is_admin());

-- farm_settings: read by everyone signed in; written only by set_collars_muted()
DROP POLICY IF EXISTS "Authenticated users can view farm settings" ON public.farm_settings;
CREATE POLICY "Authenticated users can view farm settings" ON public.farm_settings
  FOR SELECT TO authenticated USING (true);

-- push_tokens: each user only their own rows
DROP POLICY IF EXISTS "Users can view own push tokens" ON public.push_tokens;
CREATE POLICY "Users can view own push tokens" ON public.push_tokens
  FOR SELECT TO authenticated USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can add own push tokens" ON public.push_tokens;
CREATE POLICY "Users can add own push tokens" ON public.push_tokens
  FOR INSERT TO authenticated WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can update own push tokens" ON public.push_tokens;
CREATE POLICY "Users can update own push tokens" ON public.push_tokens
  FOR UPDATE TO authenticated
  USING (profile_id = (SELECT auth.uid())) WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can delete own push tokens" ON public.push_tokens;
CREATE POLICY "Users can delete own push tokens" ON public.push_tokens
  FOR DELETE TO authenticated USING (profile_id = (SELECT auth.uid()));

-- =============================================================================
-- 9. Seed row, realtime, scheduled job, API guard
-- =============================================================================

INSERT INTO public.farm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Tables the app subscribes to. Realtime applies each subscriber's RLS, and
-- every one of these has a SELECT policy for authenticated.
DO $$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'publication supabase_realtime not found - realtime not configured';
    RETURN;
  END IF;
  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['alerts', 'collars', 'livestock', 'location_logs',
                                 'geofences', 'farm_settings'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = v_table) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END
$$;

-- Daily at 19:17 UTC = 03:17 in the Philippines. cron.schedule() replaces a
-- job of the same name, so re-running this does not add a second job.
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed - retention job not scheduled';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.schedule('farmtrack-downsample-location-logs', '17 19 * * *',
                          'SELECT public.downsample_location_logs()');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'retention job not scheduled: %', SQLERRM;
  END;
END
$$;

-- Point PostgREST at farmtrack_pre_request(). Setting it on the authenticator
-- role is PostgREST's in-database configuration. If this project does not
-- allow it, the rest still commits and verify_setup.sql reports it.
DO $$
DECLARE
  v_current text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    RAISE NOTICE 'role authenticator not found - API guard not configured';
    RETURN;
  END IF;
  SELECT substring(cfg FROM '^pgrst\.db_pre_request=(.*)$') INTO v_current
  FROM pg_db_role_setting s, unnest(s.setconfig) AS cfg
  WHERE s.setrole = (SELECT oid FROM pg_roles WHERE rolname = 'authenticator')
    AND s.setdatabase = 0
    AND cfg LIKE 'pgrst.db_pre_request=%';
  IF v_current IS NOT NULL AND v_current <> 'public.farmtrack_pre_request' THEN
    RAISE WARNING 'authenticator already has pgrst.db_pre_request = %; left unchanged', v_current;
    RETURN;
  END IF;
  BEGIN
    ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.farmtrack_pre_request';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'could not set pgrst.db_pre_request on authenticator (%) - see README.md', SQLERRM;
  END;
END
$$;

-- =============================================================================
-- 10. Privileges. LAST, because Supabase's default privileges grant anon and
--     authenticated everything on each newly created object.
-- =============================================================================

-- Tables: anon gets nothing (RLS already gives it no rows; this is the
-- second lock). authenticated keeps only what its policies can use.
REVOKE ALL ON TABLE public.profiles, public.collars, public.livestock, public.geofences,
                    public.gateways, public.location_logs, public.alerts,
                    public.farm_settings, public.push_tokens
  FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.profiles, public.collars, public.livestock, public.geofences,
           public.location_logs, public.alerts, public.push_tokens
  FROM authenticated;

GRANT SELECT ON TABLE public.profiles, public.collars, public.livestock, public.geofences,
                      public.location_logs, public.alerts, public.farm_settings
  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.collars, public.livestock, public.geofences
  TO authenticated;
GRANT INSERT ON TABLE public.location_logs TO authenticated;
GRANT INSERT, DELETE ON TABLE public.alerts, public.profiles TO authenticated;

-- A user may rename themselves and their farm; never change their role.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (full_name, farm_name) ON TABLE public.profiles TO authenticated;

-- Resolving is the only change a user makes to an alert.
REVOKE UPDATE ON TABLE public.alerts FROM authenticated;
GRANT UPDATE (status, resolved_at, resolved_by) ON TABLE public.alerts TO authenticated;

REVOKE ALL ON TABLE public.gateways FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.farm_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_tokens TO authenticated;

-- The view: signed-in users only.
REVOKE ALL ON TABLE public.latest_livestock_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.latest_livestock_locations TO authenticated;

-- Functions. anon may call ingest_telemetry and nothing else.
REVOKE ALL ON FUNCTION public.ingest_telemetry(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_telemetry(text, jsonb) TO anon;

REVOKE ALL ON FUNCTION public.is_admin()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_geofences_geojson()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_geofence(uuid, text, jsonb, boolean, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_collars_muted(integer)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_geofences_geojson()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_geofence(uuid, text, jsonb, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_collars_muted(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;

-- Trigger functions and the retention job: not callable by any API role.
-- (A trigger fires regardless of who holds EXECUTE on its function.)
REVOKE ALL ON FUNCTION public.handle_new_user()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_location_point()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_geofence_events()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alerts_set_resolution()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_alert_push()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.downsample_location_logs() FROM PUBLIC, anon, authenticated;

-- PostgREST runs the pre-request function as the request's role, so every
-- API role must be able to execute it or every request fails.
REVOKE ALL ON FUNCTION public.farmtrack_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.farmtrack_pre_request() TO anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.farmtrack_pre_request() TO service_role;
  END IF;
END
$$;

-- spatial_ref_sys: try to take write access away from the API roles. On
-- Supabase the table belongs to supabase_admin, so this usually changes
-- nothing (Postgres only warns); farmtrack_pre_request() is the real guard.
DO $$
DECLARE
  v_rel regclass := COALESCE(to_regclass('public.spatial_ref_sys'), to_regclass('extensions.spatial_ref_sys'));
BEGIN
  IF v_rel IS NOT NULL THEN
    BEGIN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE %s FROM anon, authenticated', v_rel);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'spatial_ref_sys grants unchanged: %', SQLERRM;
    END;
  END IF;
END
$$;

-- PostgREST: pick up the new functions, tables and the pre-request setting.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

COMMIT;
