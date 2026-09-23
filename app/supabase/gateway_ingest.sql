-- #############################################################################
-- ##  DO NOT RUN THIS FILE AGAINST THE CURRENT DATABASE.                     ##
-- ##                                                                         ##
-- ##  It was written before we knew the live database already had a working  ##
-- ##  gateway ingest layer, and the two are incompatible:                    ##
-- ##                                                                         ##
-- ##    - live gateways uses  api_key_hash  = sha256 hex via digest()        ##
-- ##      this file creates   key_hash      = bcrypt via crypt()             ##
-- ##    - live ingest_telemetry RETURNS jsonb                                ##
-- ##      this file's         RETURNS TABLE(...)  -- CREATE OR REPLACE       ##
-- ##      cannot change a return type, so this would simply error out        ##
-- ##                                                                         ##
-- ##  Kept only as design notes. See verify_setup.sql for what is actually   ##
-- ##  deployed, and for the SQL that matches it.                             ##
-- #############################################################################
--
-- =============================================================================
-- FarmTrack: gateway telemetry ingest
-- Run this AFTER schema.sql, in the Supabase SQL editor (as the postgres role,
-- which is what the editor uses by default).
--
-- This is the backend half of the contract firmware/src/gateway.cpp already
-- speaks: it POSTs to /rest/v1/rpc/ingest_telemetry carrying only the anon key
-- plus a shared gateway secret, and expects back a JSON array of per-device
-- fence states to relay down to each collar over LoRa.
--
-- Why SECURITY DEFINER: the gateway authenticates with the anon key, so
-- PostgREST runs this as the `anon` role. RLS on location_logs only allows
-- inserts from an admin (schema.sql), and anon is not one. SECURITY DEFINER
-- makes the function run as its owner (postgres) and bypass RLS; p_gateway_key
-- is the real authentication, checked below against public.gateways.
-- =============================================================================

-- bcrypt for hashing gateway secrets. On Supabase this lands in the
-- `extensions` schema, which is why every function below sets
-- search_path = public, extensions - otherwise crypt()/gen_salt() are not found.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. gateways
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gateways (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  -- bcrypt hash of the plaintext secret that lives in firmware secrets.h.
  -- The plaintext is never stored here.
  key_hash     TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gateways ENABLE ROW LEVEL SECURITY;

-- No anon access at all: the only way a gateway touches this table is through
-- ingest_telemetry(), which bypasses RLS as a definer function.
DROP POLICY IF EXISTS "Admins can view gateways" ON public.gateways;
CREATE POLICY "Admins can view gateways"
  ON public.gateways FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage gateways" ON public.gateways;
CREATE POLICY "Admins can manage gateways"
  ON public.gateways FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =============================================================================
-- 2. Telemetry columns on location_logs
--
-- All nullable and additive, so existing rows and the app's `select('*')`
-- queries keep working untouched.
-- =============================================================================

ALTER TABLE public.location_logs
  ADD COLUMN IF NOT EXISTS seq        INTEGER,
  ADD COLUMN IF NOT EXISTS rssi       INTEGER,
  ADD COLUMN IF NOT EXISTS snr        REAL,
  ADD COLUMN IF NOT EXISTS gateway_id UUID REFERENCES public.gateways(id) ON DELETE SET NULL;

-- Supports the replay check in ingest_telemetry(). Deliberately NOT a unique
-- constraint: UplinkPacket.seq is a uint16 that wraps at 65535 and restarts at
-- 0 whenever a collar reboots, so old rows would collide with legitimate new
-- ones. Duplicates are rejected on a short time window instead.
CREATE INDEX IF NOT EXISTS location_logs_collar_seq_idx
  ON public.location_logs (collar_id, seq, timestamp DESC);

-- =============================================================================
-- 3. Register a gateway
--
-- Helper so the plaintext secret is typed once and never stored. Admin-only,
-- and it returns the gateway id.
--
--   SELECT public.register_gateway('Barn Gateway', 'the-secret-in-secrets.h');
--
-- Re-running with the same name rotates that gateway's key.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_gateway(
  p_name   TEXT,
  p_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can register gateways';
  END IF;

  IF p_secret IS NULL OR length(p_secret) < 12 THEN
    RAISE EXCEPTION 'Gateway secret must be at least 12 characters';
  END IF;

  SELECT id INTO v_id FROM public.gateways WHERE name = p_name;

  IF v_id IS NULL THEN
    INSERT INTO public.gateways (name, key_hash)
    VALUES (p_name, crypt(p_secret, gen_salt('bf')))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.gateways
    SET key_hash = crypt(p_secret, gen_salt('bf')),
        is_active = TRUE
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- 4. ingest_telemetry
--
-- Contract fixed by firmware/src/gateway.cpp (uploadReading):
--
--   in   { "p_gateway_key": "...",
--          "p_readings": [ { "device_id":"FT-1A2B3C4D", "seq":41, "ts":0,
--                            "fix":true, "lat":14.6, "lng":121.0,
--                            "battery":85, "rssi":-72, "snr":9.5 } ] }
--   out  [ { "device_id":"FT-1A2B3C4D", "state":0 } ]
--
-- `state` is FenceState from firmware/src/packet.h: 0 safe, 1 warning,
-- 2 breach. RETURNS TABLE makes PostgREST emit a JSON array, which is what
-- gateway.cpp parses (it rejects anything that is not an array).
--
-- One row is returned per reading, ALWAYS - including readings with no GPS fix
-- and unknown devices - because the gateway only sends a LoRa downlink when it
-- finds its device_id in the response. Skipping a row means that collar gets
-- no reply and stays silent for the cycle.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ingest_telemetry(
  p_gateway_key TEXT,
  p_readings    JSONB
)
RETURNS TABLE (device_id TEXT, state SMALLINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_gateway_id UUID;
  v_reading    JSONB;
  v_device     TEXT;
  v_collar_id  UUID;
  v_seq        INTEGER;
  v_ts         TIMESTAMPTZ;
  v_fix        BOOLEAN;
  v_lat        DOUBLE PRECISION;
  v_lng        DOUBLE PRECISION;
  v_battery    INTEGER;
  v_status     animal_status;
  v_duplicate  BOOLEAN;
BEGIN
  -- --- authenticate the gateway ------------------------------------------
  -- bcrypt is not reversible, so this scans active gateways and re-hashes the
  -- presented key with each stored salt. Fine for the handful of gateways a
  -- ranch has; it would need a lookup key if that ever grew large.
  SELECT g.id INTO v_gateway_id
  FROM public.gateways g
  WHERE g.is_active
    AND g.key_hash = crypt(p_gateway_key, g.key_hash)
  LIMIT 1;

  IF v_gateway_id IS NULL THEN
    -- 28000 = invalid_authorization_specification. PostgREST turns this into a
    -- 401 or 403 depending on its version; either way it is not a 200, so
    -- gateway.cpp logs "upload failed, HTTP 4xx" and sends no downlink.
    RAISE EXCEPTION 'invalid gateway key' USING ERRCODE = '28000';
  END IF;

  UPDATE public.gateways SET last_seen_at = NOW() WHERE id = v_gateway_id;

  IF p_readings IS NULL OR jsonb_typeof(p_readings) <> 'array' THEN
    RETURN;
  END IF;

  FOR v_reading IN SELECT * FROM jsonb_array_elements(p_readings)
  LOOP
    v_device := v_reading->>'device_id';
    CONTINUE WHEN v_device IS NULL;

    v_seq     := NULLIF(v_reading->>'seq', '')::INTEGER;
    v_fix     := COALESCE((v_reading->>'fix')::BOOLEAN, FALSE);
    v_lat     := NULLIF(v_reading->>'lat', '')::DOUBLE PRECISION;
    v_lng     := NULLIF(v_reading->>'lng', '')::DOUBLE PRECISION;
    v_battery := NULLIF(v_reading->>'battery', '')::INTEGER;

    -- collar.cpp never fills gpsEpoch (it is a documented TODO and always
    -- sends 0), so fall back to the server clock.
    v_ts := CASE
              WHEN COALESCE(NULLIF(v_reading->>'ts', '')::BIGINT, 0) > 0
                THEN to_timestamp((v_reading->>'ts')::BIGINT)
              ELSE NOW()
            END;

    -- --- resolve the collar ----------------------------------------------
    SELECT c.id INTO v_collar_id
    FROM public.collars c
    WHERE c.device_hardware_id = v_device;

    -- Auto-register a collar on first contact. It shows up unpaired in the
    -- app's hardware tab, ready to attach to an animal - no copying IDs out of
    -- the serial monitor. Anyone holding the gateway secret can create collar
    -- rows this way; delete this block if you would rather register by hand.
    -- connection_type is forced to 'LTE' only because the enum in schema.sql
    -- is ('LTE','Satellite') and has no LoRa member, which is what this
    -- hardware actually uses. To label it honestly in the app, run:
    --   ALTER TYPE connection_type ADD VALUE IF NOT EXISTS 'LoRa';
    -- (in its own transaction, before this file) and change 'LTE' below.
    IF v_collar_id IS NULL THEN
      INSERT INTO public.collars (device_hardware_id, connection_type, signal_strength)
      VALUES (v_device, 'LTE', 'Good')
      ON CONFLICT (device_hardware_id) DO NOTHING
      RETURNING id INTO v_collar_id;

      IF v_collar_id IS NULL THEN
        SELECT c.id INTO v_collar_id
        FROM public.collars c
        WHERE c.device_hardware_id = v_device;
      END IF;
    END IF;

    -- --- collar health ----------------------------------------------------
    -- Note the explicit NULL check rather than COALESCE(LEAST(GREATEST(...)))
    -- GREATEST/LEAST ignore NULL arguments in Postgres, so GREATEST(NULL, 0)
    -- is 0, not NULL - a reading with no battery field would have clamped the
    -- stored level to 0% instead of leaving it alone.
    UPDATE public.collars
    SET battery_level = CASE
                          WHEN v_battery IS NULL THEN battery_level
                          ELSE LEAST(GREATEST(v_battery, 0), 100)
                        END,
        last_ping_at  = NOW(),
        status        = 'active'
    WHERE id = v_collar_id;

    -- --- log the position -------------------------------------------------
    -- Without a fix, collar.cpp sends lat/lng as 0,0. Logging that would drop
    -- the animal onto Null Island and fire a bogus breach, so only real fixes
    -- are stored; the collar still gets its last known state back below.
    IF v_fix AND v_lat IS NOT NULL AND v_lng IS NOT NULL THEN

      -- Drop retransmits of a packet already logged. Bounded to a short window
      -- so a collar reboot (seq restarts at 0) is not mistaken for a replay.
      SELECT EXISTS (
        SELECT 1 FROM public.location_logs ll
        WHERE ll.collar_id = v_collar_id
          AND ll.seq = v_seq
          AND ll.timestamp > NOW() - INTERVAL '5 minutes'
      ) INTO v_duplicate;

      IF NOT v_duplicate THEN
        -- The AFTER INSERT trigger detect_geofence_events() runs here: it
        -- writes any alerts and updates livestock.animal_status, so the read
        -- below already sees this reading's result.
        INSERT INTO public.location_logs (
          collar_id, latitude, longitude, timestamp, seq, rssi, snr, gateway_id
        )
        VALUES (
          v_collar_id,
          v_lat,
          v_lng,
          v_ts,
          v_seq,
          NULLIF(v_reading->>'rssi', '')::INTEGER,
          NULLIF(v_reading->>'snr', '')::REAL,
          v_gateway_id
        );
      END IF;
    END IF;

    -- --- fence state to relay back ---------------------------------------
    -- NULL when the collar is not yet paired to an animal: detect_geofence_
    -- events() bails out early in that case, so there is no status to report
    -- and the collar is told it is safe.
    SELECT l.animal_status INTO v_status
    FROM public.livestock l
    WHERE l.collar_id = v_collar_id
    LIMIT 1;

    device_id := v_device;
    state := CASE v_status
               WHEN 'breach'        THEN 2   -- FENCE_STATE_BREACH
               WHEN 'near_boundary' THEN 1   -- FENCE_STATE_WARNING
               ELSE 0                        -- FENCE_STATE_SAFE
             END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- =============================================================================
-- 5. Grants
-- =============================================================================

-- The gateway presents only the anon key, so anon must be able to call this
-- one function - and nothing else new. The gateway secret is what actually
-- authorizes the call.
REVOKE ALL ON FUNCTION public.ingest_telemetry(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_telemetry(TEXT, JSONB) TO anon, authenticated;

-- register_gateway is admin-only and enforces that itself; anon never sees it.
REVOKE ALL ON FUNCTION public.register_gateway(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_gateway(TEXT, TEXT) TO authenticated;

-- gateways is reachable only through the definer functions above.
REVOKE ALL ON TABLE public.gateways FROM anon;

-- =============================================================================
-- 6. After running this file
-- =============================================================================
--
-- a) Register the gateway, signed in as an admin, with the same secret you put
--    in firmware/src/secrets.h as GATEWAY_SECRET:
--
--      SELECT public.register_gateway('Barn Gateway', 'your-real-secret');
--
-- b) Draw at least one geofence and leave it active, or detect_geofence_events()
--    has nothing to test against and every collar stays at state 0.
--
-- c) Pair each collar to a livestock row. Until then the collar is logged and
--    mapped but always reports safe.
--
-- Smoke test without any hardware - substitute a real registered secret:
--
--   SELECT * FROM public.ingest_telemetry(
--     'your-real-secret',
--     '[{"device_id":"FT-DEADBEEF","seq":1,"ts":0,"fix":true,
--        "lat":14.5995,"lng":120.9842,"battery":85,"rssi":-70,"snr":9.0}]'::jsonb
--   );
--
-- Expect one row back: FT-DEADBEEF with a state of 0, 1 or 2. A 401 from the
-- gateway means the secret does not match what register_gateway() stored.
