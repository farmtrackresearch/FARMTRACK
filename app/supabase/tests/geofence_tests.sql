-- =============================================================================
-- FarmTrack: step 4 of 4 - automated tests of the fence logic and the ingest.
--
-- Supabase -> SQL Editor -> paste this whole file -> Run.
-- Expected result: one row starting  ALL TESTS PASSED  (followed by a list
-- in brackets of any check this project could not run, e.g. without pg_net).
-- A failure stops at the first broken rule with "TEST FAILED: <what>".
-- If Supabase warns that this query "creates tables without enabling Row
-- Level Security", click "Run without RLS": the only table is the temporary
-- scratch table ft_ctx below, which the ROLLBACK at the end removes.
--
-- Nothing is kept: everything runs inside one transaction that is rolled
-- back at the end, so no test collar, animal, fence or alert is left behind,
-- the app never sees them, and no push notification is sent (pg_net only
-- sends after a commit). For the length of the run the real fences are
-- switched off inside the transaction only; the live system is unaffected.
--
-- Every reading uses an explicit, distinct GPS time (ts) so the results do
-- not depend on when you run it.
-- =============================================================================

BEGIN;
SET LOCAL search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Helpers (temporary, gone after the rollback)
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE ft_ctx (k text PRIMARY KEY, v text);
GRANT ALL ON pg_temp.ft_ctx TO PUBLIC;

CREATE FUNCTION pg_temp.ft_get(p_k text) RETURNS text LANGUAGE sql AS
$$ SELECT v FROM pg_temp.ft_ctx WHERE k = p_k $$;

CREATE FUNCTION pg_temp.ft_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO pg_temp.ft_ctx VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $$;

CREATE FUNCTION pg_temp.ft_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: %', p_what;
  END IF;
END $$;

-- Calls the ingest exactly as the gateway does: as the anon role.
CREATE FUNCTION pg_temp.ft_ingest(p_readings jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_key  text := pg_temp.ft_get('gateway_key');
  v_resp jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  v_resp := public.ingest_telemetry(v_key, p_readings);
  EXECUTE 'RESET ROLE';
  RETURN v_resp;
END $$;

-- Act as a signed-in app user / go back to the SQL editor's own role.
CREATE FUNCTION pg_temp.ft_login(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION pg_temp.ft_logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

CREATE FUNCTION pg_temp.ft_state(p_resp jsonb, p_device text) RETURNS integer LANGUAGE sql AS
$$ SELECT (e ->> 'state')::integer FROM jsonb_array_elements(p_resp) e WHERE e ->> 'device_id' = p_device $$;

-- A point p_depth metres inside test fence A's west edge (negative = outside
-- to the west), p_north metres north of the edge's midpoint.
CREATE FUNCTION pg_temp.ft_pt(p_depth double precision, p_north double precision DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  g geography := ST_SetSRID(ST_MakePoint(pg_temp.ft_get('lng0')::double precision,
                                         pg_temp.ft_get('latmid')::double precision), 4326)::geography;
BEGIN
  IF p_depth <> 0 THEN
    g := ST_Project(g, abs(p_depth), CASE WHEN p_depth > 0 THEN pi() / 2 ELSE 3 * pi() / 2 END);
  END IF;
  IF p_north <> 0 THEN
    g := ST_Project(g, abs(p_north), CASE WHEN p_north > 0 THEN 0 ELSE pi() END);
  END IF;
  RETURN jsonb_build_object('lat', ST_Y(g::geometry), 'lng', ST_X(g::geometry));
END $$;

-- One reading as the v2 gateway sends it; p_extra overrides any field.
CREATE FUNCTION pg_temp.ft_r(p_device text, p_seq integer, p_ts bigint, p_depth double precision,
                             p_extra jsonb DEFAULT '{}'::jsonb, p_north double precision DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('device_id', p_device, 'seq', p_seq, 'ts', p_ts, 'fix', true,
                            'battery', NULL, 'rssi', -80, 'snr', 9.5, 'sats', 9,
                            'gps_ok', true, 'gps_restarted', false, 'age_ms', 300)
         || pg_temp.ft_pt(p_depth, p_north) || p_extra
$$;

-- GPS time for test step n: distinct, recent (the state rule ignores fixes
-- older than 60 s) and never more than 30 s in the future.
CREATE FUNCTION pg_temp.ft_ts(p_n integer) RETURNS bigint LANGUAGE sql AS
$$ SELECT pg_temp.ft_get('t0')::bigint - 50 + p_n $$;

-- A collar paired to a new animal; returns the animal's id.
CREATE FUNCTION pg_temp.ft_animal(p_device text) RETURNS uuid LANGUAGE sql AS $$
  WITH c AS (INSERT INTO public.collars (device_hardware_id) VALUES (p_device) RETURNING id)
  INSERT INTO public.livestock (tag_id, name, breed, collar_id)
  SELECT 'TEST-' || p_device, 'Test ' || p_device, 'Test', c.id FROM c
  RETURNING id
$$;

CREATE FUNCTION pg_temp.ft_status(p_animal uuid) RETURNS text LANGUAGE sql AS
$$ SELECT animal_status::text FROM public.livestock WHERE id = p_animal $$;

CREATE FUNCTION pg_temp.ft_alerts(p_animal uuid, p_type text, p_status text DEFAULT NULL)
RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.alerts
  WHERE livestock_id = p_animal AND alert_type::text = p_type
    AND (p_status IS NULL OR status::text = p_status)
$$;

CREATE FUNCTION pg_temp.ft_rows(p_device text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id WHERE c.device_hardware_id = p_device
$$;

CREATE FUNCTION pg_temp.ft_fences(p_active text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE public.geofences SET is_active = (name = ANY (p_active))
$$;

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_key   text := 'farmtrack-test-' || gen_random_uuid();
  v_sw    geography := ST_SetSRID(ST_MakePoint(122.5, 10.5), 4326)::geography;  -- open sea, far from any farm
  v_nw    geography;
  v_se    geography;
  v_ne    geography;
  v_admin uuid;
  v_staff uuid;
BEGIN
  PERFORM pg_temp.ft_set('t0', floor(extract(epoch FROM now()))::bigint::text);
  PERFORM pg_temp.ft_set('gateway_key', v_key);
  INSERT INTO public.gateways (name, api_key_hash)
  VALUES ('TEST gateway', encode(digest(v_key, 'sha256'), 'hex'));

  -- Fence A: 200 m x 200 m square, warning buffer 30 m.
  v_nw := ST_Project(v_sw, 200, 0);
  v_se := ST_Project(v_sw, 200, pi() / 2);
  v_ne := ST_Project(v_nw, 200, pi() / 2);
  PERFORM pg_temp.ft_set('lng0', ST_X(v_sw::geometry)::text);
  PERFORM pg_temp.ft_set('latmid', ((ST_Y(v_sw::geometry) + ST_Y(v_nw::geometry)) / 2)::text);
  INSERT INTO public.geofences (name, coordinates, is_active, warning_buffer_meters)
  VALUES ('TEST A', ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[
            v_sw::geometry, v_se::geometry, v_ne::geometry, v_nw::geometry, v_sw::geometry])), 4326), true, 30);
  -- Fence B: 200 m square 20 km east (inside B but outside A must be safe).
  INSERT INTO public.geofences (name, coordinates, is_active, warning_buffer_meters)
  SELECT 'TEST B', ST_Translate(g.coordinates, 0.2, 0), true, 30 FROM public.geofences g WHERE g.name = 'TEST A';
  -- Fence C: 200 m square straddling A's west edge (100 m each side).
  INSERT INTO public.geofences (name, coordinates, is_active, warning_buffer_meters)
  SELECT 'TEST C', ST_Translate(g.coordinates, -(ST_X(v_se::geometry) - ST_X(v_sw::geometry)) / 2, 0), false, 30
  FROM public.geofences g WHERE g.name = 'TEST A';

  PERFORM pg_temp.ft_fences(ARRAY['TEST A']);                  -- real fences off (this transaction only)
  UPDATE public.farm_settings SET collars_muted_until = NULL WHERE id = 1;

  -- Users. Created through auth.users when this role may (which also tests
  -- the sign-up trigger); otherwise the project's existing accounts are used.
  IF has_table_privilege('auth.users', 'INSERT') THEN
    v_admin := gen_random_uuid();
    v_staff := gen_random_uuid();
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_admin, 'ft-test-' || v_admin || '@example.invalid', '{"full_name": "Test Admin"}'::jsonb),
           (v_staff, NULL, '{"role": "admin"}'::jsonb);   -- asks to be admin at sign-up; no name, no email
    PERFORM pg_temp.ft_assert((SELECT role::text FROM public.profiles WHERE id = v_staff) = 'staff',
      'sign-up asking for role=admin still gets a staff profile');
    PERFORM pg_temp.ft_assert((SELECT full_name FROM public.profiles WHERE id = v_staff) = 'New user',
      'sign-up with no name and no email gets the fallback name');
    PERFORM pg_temp.ft_assert((SELECT full_name FROM public.profiles WHERE id = v_admin) = 'Test Admin',
      'sign-up keeps the full_name from metadata');
    UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;
  ELSE
    SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
    SELECT id INTO v_staff FROM public.profiles WHERE role = 'staff' ORDER BY created_at LIMIT 1;
  END IF;
  PERFORM pg_temp.ft_set('admin', v_admin::text);
  PERFORM pg_temp.ft_set('staff', v_staff::text);

  -- Whatever the data, the sign-up function must never read a role from metadata.
  PERFORM pg_temp.ft_assert(
    pg_get_functiondef('public.handle_new_user()'::regprocedure) NOT ILIKE '%raw_user_meta_data%''role''%',
    'handle_new_user never reads the role from sign-up metadata');
END $$;

-- -----------------------------------------------------------------------------
-- 1. Response shape, authentication, input checks
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_resp jsonb;
  v_ok   boolean;
BEGIN
  PERFORM pg_temp.ft_animal('FT-7E570101');
  PERFORM pg_temp.ft_animal('FT-7E570102');

  v_resp := pg_temp.ft_ingest('[]'::jsonb);
  PERFORM pg_temp.ft_assert(v_resp = '[]'::jsonb, 'empty batch returns []');

  -- Two devices, interleaved: one element per device, seq = its newest reading.
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570101', 10, pg_temp.ft_ts(1), 80),
    pg_temp.ft_r('FT-7E570102', 20, pg_temp.ft_ts(2), 80),
    pg_temp.ft_r('FT-7E570101', 11, pg_temp.ft_ts(3), 80)));
  PERFORM pg_temp.ft_assert(jsonb_typeof(v_resp) = 'array' AND jsonb_array_length(v_resp) = 2,
    'response is a bare array with one element per device, got ' || v_resp::text);
  PERFORM pg_temp.ft_assert(
    (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) = ARRAY['device_id', 'seq', 'state'])
     FROM jsonb_array_elements(v_resp) e),
    'each element has exactly device_id, seq, state: ' || v_resp::text);
  PERFORM pg_temp.ft_assert(v_resp -> 0 ->> 'device_id' = 'FT-7E570101' AND (v_resp -> 0 ->> 'seq')::int = 11,
    'seq is the device''s newest reading in the batch: ' || v_resp::text);
  PERFORM pg_temp.ft_assert(jsonb_typeof(v_resp -> 0 -> 'state') = 'number'
                            AND jsonb_typeof(v_resp -> 0 -> 'seq') = 'number',
    'seq and state are JSON numbers');

  -- A wrong key is refused (HTTP 403 through PostgREST).
  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.ingest_telemetry('not-the-key', '[]'::jsonb);
  EXCEPTION WHEN invalid_authorization_specification THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'a wrong gateway key is rejected with 28000');

  v_ok := false;
  BEGIN
    PERFORM pg_temp.ft_ingest('{"not": "an array"}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'p_readings that is not an array is rejected');

  -- A v1 gateway (no sats/gps_ok/age_ms, battery 85) still works.
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    jsonb_build_object('device_id', 'FT-7E570102', 'seq', 21, 'ts', 0, 'fix', true, 'battery', 85,
                       'rssi', -70, 'snr', 9.0) || pg_temp.ft_pt(80)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570102') = 0 AND pg_temp.ft_rows('FT-7E570102') = 2,
    'a v1-shaped reading is stored and answered');
END $$;

-- -----------------------------------------------------------------------------
-- 2. Breach at any distance; transitions-only alerts; audio counter
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a    uuid := pg_temp.ft_animal('FT-7E570201');
  v_resp jsonb;
BEGIN
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570201', 1, pg_temp.ft_ts(1), -2)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570201') = 2, '2 m outside the only fence is BREACH (state 2)');
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'breach', 'animal_status becomes breach');
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'boundary_breach', 'unresolved') = 1, 'one breach alert is opened');

  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570201', 2, pg_temp.ft_ts(2), -5000)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570201') = 2, '5 km outside is still BREACH');
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'boundary_breach') = 1, 'staying in breach opens no second alert');
  PERFORM pg_temp.ft_assert((SELECT audio_warning_count FROM public.livestock WHERE id = v_a) = 1,
    'audio_warning_count counts the one entry into breach');
  PERFORM pg_temp.ft_assert(
    (SELECT description FROM public.alerts WHERE livestock_id = v_a AND alert_type = 'boundary_breach') LIKE '%outside every fence%',
    'breach alert says the animal is outside every fence');
END $$;

-- -----------------------------------------------------------------------------
-- 3. Several fences, and no fences
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a     uuid := pg_temp.ft_animal('FT-7E570301');
  v_resp  jsonb;
  v_b_mid jsonb;
BEGIN
  PERFORM pg_temp.ft_fences(ARRAY['TEST A', 'TEST B']);
  SELECT jsonb_build_object('lat', ST_Y(ST_Centroid(coordinates)), 'lng', ST_X(ST_Centroid(coordinates)))
    INTO v_b_mid FROM public.geofences WHERE name = 'TEST B';
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570301', 1, pg_temp.ft_ts(1), 0) || v_b_mid));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570301') = 0 AND pg_temp.ft_status(v_a) = 'grazing',
    'inside fence B but outside fence A is SAFE');

  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570301', 2, pg_temp.ft_ts(2), -50)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570301') = 2, 'outside both fences is BREACH');

  -- Warning is judged on the fence the point is deepest inside: 10 m inside
  -- A (A alone would warn) but about 90 m inside C.
  PERFORM pg_temp.ft_fences(ARRAY['TEST A', 'TEST B', 'TEST C']);
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570301', 3, pg_temp.ft_ts(3), 10)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'grazing' AND pg_temp.ft_state(v_resp, 'FT-7E570301') = 0,
    'near A''s edge but deep inside overlapping fence C is SAFE (deepest fence decides), got ' || pg_temp.ft_status(v_a));
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'boundary_breach', 'unresolved') = 0,
    'coming back inside resolved the breach alert');

  -- No active fences at all: SAFE, even far away.
  PERFORM pg_temp.ft_fences(ARRAY[]::text[]);
  UPDATE public.livestock SET animal_status = 'breach' WHERE id = v_a;
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570301', 4, pg_temp.ft_ts(4), -9000)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570301') = 0 AND pg_temp.ft_status(v_a) = 'grazing',
    'with no active fences the animal is SAFE (grazing)');

  PERFORM pg_temp.ft_fences(ARRAY['TEST A']);
END $$;

-- -----------------------------------------------------------------------------
-- 4. Hysteresis (buffer 30 m, hysteresis 3 m) and auto-resolve
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a    uuid := pg_temp.ft_animal('FT-7E570401');
  v_resp jsonb;
  v_step record;
BEGIN
  FOR v_step IN
    SELECT * FROM (VALUES
      (1,  40.0, 'grazing',       0, 'deep inside'),
      (2,  25.0, 'near_boundary', 1, 'within the 30 m buffer'),
      (3,  31.0, 'near_boundary', 1, 'warning holds until depth > buffer + 3 m'),
      (4,  35.0, 'grazing',       0, 'depth 35 > 33 clears the warning'),
      (5,  -3.0, 'breach',        2, 'just outside'),
      (6,   1.5, 'breach',        2, 'breach holds until 3 m inside'),
      (7,   5.0, 'near_boundary', 1, '5 m inside leaves breach into warning'),
      (8,  40.0, 'grazing',       0, 'back deep inside')
    ) AS s(n, depth, status, state, what)
  LOOP
    v_resp := pg_temp.ft_ingest(jsonb_build_array(
      pg_temp.ft_r('FT-7E570401', v_step.n, pg_temp.ft_ts(v_step.n), v_step.depth)));
    PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = v_step.status
                              AND pg_temp.ft_state(v_resp, 'FT-7E570401') = v_step.state,
      format('hysteresis step %s (%s m, %s): expected %s/%s, got %s/%s', v_step.n, v_step.depth, v_step.what,
             v_step.status, v_step.state, pg_temp.ft_status(v_a), pg_temp.ft_state(v_resp, 'FT-7E570401')));
  END LOOP;

  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'approach_warning') = 2, 'one warning alert per entry into warning (2)');
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'boundary_breach') = 1, 'one breach alert for one breach');
  PERFORM pg_temp.ft_assert(
    (SELECT count(*) FROM public.alerts WHERE livestock_id = v_a AND status = 'unresolved') = 0,
    'every fence alert was resolved automatically when the animal left that state');
  PERFORM pg_temp.ft_assert(
    (SELECT bool_and(resolved_at IS NOT NULL AND resolved_by IS NULL) FROM public.alerts WHERE livestock_id = v_a),
    'server-resolved alerts get resolved_at and no resolved_by');
  PERFORM pg_temp.ft_assert((SELECT audio_warning_count FROM public.livestock WHERE id = v_a) = 3,
    'audio_warning_count: warning, breach, warning = 3');
END $$;

-- -----------------------------------------------------------------------------
-- 5. resting is kept over grazing (but not over a warning)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a    uuid := pg_temp.ft_animal('FT-7E570501');
  v_resp jsonb;
BEGIN
  UPDATE public.livestock SET animal_status = 'resting' WHERE id = v_a;
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570501', 1, pg_temp.ft_ts(1), 80)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'resting' AND pg_temp.ft_state(v_resp, 'FT-7E570501') = 0,
    'a safe position keeps resting');
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570501', 2, pg_temp.ft_ts(2), 20)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'near_boundary', 'a warning position overrides resting');
END $$;

-- -----------------------------------------------------------------------------
-- 6. Out-of-order readings are stored but change nothing
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a    uuid := pg_temp.ft_animal('FT-7E570601');
  v_resp jsonb;
BEGIN
  PERFORM pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570601', 5, pg_temp.ft_ts(20), 80)));
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570601', 4, pg_temp.ft_ts(10), -40)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E570601') = 2, 'the late (older) reading is stored');
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'grazing' AND pg_temp.ft_alerts(v_a, 'boundary_breach') = 0,
    'an older reading outside the fence does not raise a breach');
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570601') = 0,
    'the collar is told the state of its newest fix');

  -- Within one batch, readings are applied in array order (oldest first).
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570601', 6, pg_temp.ft_ts(21), -40),
    pg_temp.ft_r('FT-7E570601', 7, pg_temp.ft_ts(22), 80)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'grazing'
                            AND pg_temp.ft_alerts(v_a, 'boundary_breach') = 1
                            AND pg_temp.ft_alerts(v_a, 'boundary_breach', 'unresolved') = 0,
    'a batch goes out and back in: one breach alert, resolved, final state safe');
END $$;

-- -----------------------------------------------------------------------------
-- 7. De-duplication of re-sent readings
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_r jsonb;
BEGIN
  PERFORM pg_temp.ft_animal('FT-7E570701');

  -- ts > 0: same collar, seq and GPS time -> one row.
  v_r := pg_temp.ft_r('FT-7E570701', 30, pg_temp.ft_ts(1), 80);
  PERFORM pg_temp.ft_ingest(jsonb_build_array(v_r));
  PERFORM pg_temp.ft_ingest(jsonb_build_array(v_r || '{"age_ms": 4200}'::jsonb));
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E570701') = 1, 'a retried reading with a GPS time is stored once');

  -- ts = 0: the retry carries a different age_ms -> still one row.
  PERFORM pg_temp.ft_animal('FT-7E570702');
  v_r := pg_temp.ft_r('FT-7E570702', 40, 0, 80, '{"age_ms": 3000}'::jsonb);
  PERFORM pg_temp.ft_ingest(jsonb_build_array(v_r));
  PERFORM pg_temp.ft_ingest(jsonb_build_array(v_r || '{"age_ms": 800}'::jsonb));
  PERFORM pg_temp.ft_ingest(jsonb_build_array(v_r || '{"age_ms": 800}'::jsonb, v_r || '{"age_ms": 900}'::jsonb));
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E570702') = 1,
    'a retried reading without GPS time (ts=0, different age_ms) is stored once, got ' || pg_temp.ft_rows('FT-7E570702'));

  -- ts = 0, same seq but heard 40 s apart: a collar that rebooted, not a retry.
  PERFORM pg_temp.ft_ingest(jsonb_build_array(v_r || '{"age_ms": 43000}'::jsonb));
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E570702') = 2, 'the same seq heard 40 s apart is a new reading');

  -- ts = 0 is stored with the gateway's receive time, received_at = server time.
  PERFORM pg_temp.ft_assert(
    (SELECT bool_and(ll.received_at = now() AND ll."timestamp" <= now()) FROM public.location_logs ll
     JOIN public.collars c ON c.id = ll.collar_id WHERE c.device_hardware_id = 'FT-7E570702'),
    'ts=0 readings: timestamp = now() - age_ms, received_at = now()');
  PERFORM pg_temp.ft_assert(
    (SELECT ll."timestamp" = to_timestamp(pg_temp.ft_ts(1)) FROM public.location_logs ll
     JOIN public.collars c ON c.id = ll.collar_id WHERE c.device_hardware_id = 'FT-7E570701'),
    'a plausible GPS time is stored as the fix time');
END $$;

-- -----------------------------------------------------------------------------
-- 8. State returned to the collar: no fix, stale fix, mute
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a    uuid := pg_temp.ft_animal('FT-7E570801');
  v_user uuid := COALESCE(pg_temp.ft_get('staff'), pg_temp.ft_get('admin'))::uuid;
  v_resp jsonb;
  v_nofix jsonb := '{"fix": false, "lat": null, "lng": null, "sats": 0}'::jsonb;
  v_until timestamptz;
  v_ok   boolean;
BEGIN
  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570801', 1, pg_temp.ft_ts(1), -30)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 2, 'setup: animal in breach');

  v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570801', 2, 0, 0, v_nofix)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 0, 'a reading with no fix is answered SAFE');
  PERFORM pg_temp.ft_assert(pg_temp.ft_status(v_a) = 'breach', 'a no-fix reading does not change the animal''s state');

  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570801', 3, pg_temp.ft_ts(3), -30),
    pg_temp.ft_r('FT-7E570801', 4, 0, 0, v_nofix)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 0 AND (v_resp -> 0 ->> 'seq')::int = 4,
    'the newest reading of the batch decides: it has no fix -> SAFE');
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570801', 5, 0, 0, v_nofix),
    pg_temp.ft_r('FT-7E570801', 6, pg_temp.ft_ts(6), -30)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 2, 'newest reading has a fix -> BREACH');

  -- Newest stored fix more than 60 s old -> SAFE (a buffered burst after a WiFi drop).
  PERFORM pg_temp.ft_animal('FT-7E570802');
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570802', 1, pg_temp.ft_get('t0')::bigint - 120, -30)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570802') = 0,
    'a fix older than 60 s is answered SAFE even when it is a breach');

  -- Mute (Emergency Disable).
  IF v_user IS NOT NULL THEN
    PERFORM pg_temp.ft_login(v_user);
    v_until := public.set_collars_muted(60);
    PERFORM pg_temp.ft_logout();
    PERFORM pg_temp.ft_assert(v_until BETWEEN now() + interval '59 minutes' AND now() + interval '61 minutes',
      'set_collars_muted(60) returns now + 60 min');
    PERFORM pg_temp.ft_assert((SELECT updated_by FROM public.farm_settings WHERE id = 1) = v_user,
      'farm_settings records who muted');
    v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570801', 7, pg_temp.ft_ts(7), -30)));
    PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 0, 'muted farm: collar is told SAFE');
    PERFORM pg_temp.ft_login(v_user);
    v_until := public.set_collars_muted(0);
    PERFORM pg_temp.ft_logout();
    PERFORM pg_temp.ft_assert(v_until IS NULL, 'set_collars_muted(0) unmutes and returns NULL');
    v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570801', 8, pg_temp.ft_ts(8), -30)));
    PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 2, 'unmuted: BREACH is relayed again');
  ELSE
    UPDATE public.farm_settings SET collars_muted_until = now() + interval '1 hour' WHERE id = 1;
    v_resp := pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570801', 7, pg_temp.ft_ts(7), -30)));
    PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570801') = 0, 'muted farm: collar is told SAFE');
    UPDATE public.farm_settings SET collars_muted_until = NULL WHERE id = 1;
  END IF;

  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.set_collars_muted(60);
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'anon cannot mute the collars');
END $$;

-- -----------------------------------------------------------------------------
-- 9. Bad input: (0,0), out of range, one broken reading, unknown collars
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_resp jsonb;
BEGIN
  PERFORM pg_temp.ft_animal('FT-7E570901');
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570901', 1, pg_temp.ft_ts(1), 0, '{"lat": 0, "lng": 0}'::jsonb),
    pg_temp.ft_r('FT-7E570901', 2, pg_temp.ft_ts(2), 0, '{"lat": 95.1}'::jsonb),
    pg_temp.ft_r('FT-7E570901', 3, pg_temp.ft_ts(3), 0, '{"lng": -181}'::jsonb),
    pg_temp.ft_r('FT-7E570901', 4, pg_temp.ft_ts(4), 0, '{"lat": "9.5"}'::jsonb)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E570901') = 0, '(0,0), out-of-range and non-numeric positions are not stored');
  PERFORM pg_temp.ft_assert(pg_temp.ft_state(v_resp, 'FT-7E570901') = 0, 'an unusable position is answered SAFE');

  -- One reading that fails inside the database does not sink the batch.
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E570901', 5, pg_temp.ft_ts(5), 80, '{"snr": 1e300}'::jsonb),
    pg_temp.ft_r('FT-7E570901', 6, pg_temp.ft_ts(6), 80)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E570901') = 1, 'the broken reading is skipped, the good one stored');

  -- Unknown collar: registered on first contact, unpaired, answered SAFE.
  v_resp := pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E57FFFF', 1, pg_temp.ft_ts(1), -40),
    jsonb_build_object('device_id', 'NOT-A-COLLAR', 'seq', 1, 'ts', 0, 'fix', false)));
  PERFORM pg_temp.ft_assert(
    (SELECT connection_type::text = 'LoRa' AND battery_level IS NULL FROM public.collars WHERE device_hardware_id = 'FT-7E57FFFF'),
    'an unknown FT- collar is registered (LoRa, battery unknown)');
  PERFORM pg_temp.ft_assert(pg_temp.ft_rows('FT-7E57FFFF') = 1 AND pg_temp.ft_state(v_resp, 'FT-7E57FFFF') = 0,
    'its position is kept, and an unpaired collar is answered SAFE');
  PERFORM pg_temp.ft_assert(jsonb_array_length(v_resp) = 1 AND NOT EXISTS (
      SELECT 1 FROM public.collars WHERE device_hardware_id = 'NOT-A-COLLAR'),
    'a malformed device_id is ignored, not registered');
END $$;

-- -----------------------------------------------------------------------------
-- 10. Battery: unknown, low-battery alert and its resolution; last_ping_at
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a      uuid := pg_temp.ft_animal('FT-7E571001');
  v_n      integer := 0;
  v_step   record;
BEGIN
  FOR v_step IN
    SELECT * FROM (VALUES
      ('15'::jsonb,  15,   1, 'below 20 %: alert opened'),
      ('10'::jsonb,  10,   1, 'still low: no second alert'),
      ('25'::jsonb,  25,   1, '25 %: alert stays open until 30 %'),
      ('35'::jsonb,  35,   0, '35 %: alert resolved'),
      ('255'::jsonb, NULL, 0, '255 = unknown'),
      ('null'::jsonb, NULL, 0, 'null = unknown')
    ) AS s(sent, stored, open_alerts, what)
  LOOP
    v_n := v_n + 1;
    PERFORM pg_temp.ft_ingest(jsonb_build_array(
      pg_temp.ft_r('FT-7E571001', v_n, pg_temp.ft_ts(v_n), 80, jsonb_build_object('battery', v_step.sent))));
    PERFORM pg_temp.ft_assert(
      (SELECT battery_level IS NOT DISTINCT FROM v_step.stored FROM public.collars WHERE device_hardware_id = 'FT-7E571001')
      AND pg_temp.ft_alerts(v_a, 'low_battery', 'unresolved') = v_step.open_alerts,
      'battery ' || v_step.sent::text || ': ' || v_step.what);
  END LOOP;
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'low_battery') = 1, 'exactly one low-battery alert overall');

  -- A collar heard for the first time 5 s before the upload.
  PERFORM pg_temp.ft_ingest(jsonb_build_array(
    pg_temp.ft_r('FT-7E571002', 1, pg_temp.ft_ts(1), 80, '{"age_ms": 5000}'::jsonb)));
  PERFORM pg_temp.ft_assert(
    (SELECT last_ping_at = now() - interval '5 seconds' FROM public.collars WHERE device_hardware_id = 'FT-7E571002'),
    'last_ping_at is when the gateway heard the collar (now - age_ms)');
END $$;

-- -----------------------------------------------------------------------------
-- 11. Stationary: < 15 m in 60 minutes opens an alert; moving resolves it
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_a  uuid := pg_temp.ft_animal('FT-7E571101');
  v_t0 bigint := pg_temp.ft_get('t0')::bigint;
  v_off integer;
  v_n  integer := 0;
BEGIN
  FOREACH v_off IN ARRAY ARRAY[3800, 3000, 2400, 1800, 1200, 600, 120] LOOP
    v_n := v_n + 1;
    PERFORM pg_temp.ft_ingest(jsonb_build_array(
      pg_temp.ft_r('FT-7E571101', v_n, v_t0 - v_off, 80 + (v_n % 2) * 2)));   -- jitters by 2 m
  END LOOP;
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'stationary', 'unresolved') = 1,
    'no movement over 60 minutes opens a stationary alert');

  PERFORM pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E571101', 20, v_t0 - 20, 80, '{}'::jsonb, 50)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts(v_a, 'stationary', 'unresolved') = 0
                            AND pg_temp.ft_alerts(v_a, 'stationary') = 1,
    'moving 50 m resolves the stationary alert');
END $$;

-- -----------------------------------------------------------------------------
-- 12. Fences through the app's RPCs
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid := pg_temp.ft_get('admin')::uuid;
  v_staff uuid := pg_temp.ft_get('staff')::uuid;
  v_id    uuid;
  v_f     record;
  v_ok    boolean;
  v_ring  jsonb := '[[122.6, 10.6], [122.601, 10.6], [122.601, 10.601], [122.6, 10.601]]'::jsonb;  -- not closed
  v_geo   jsonb;
BEGIN
  IF v_admin IS NULL THEN
    RAISE NOTICE 'fence RPC tests skipped: no admin account';
    RETURN;
  END IF;
  PERFORM pg_temp.ft_login(v_admin);
  v_id := public.upsert_geofence(NULL, 'TEST RPC', v_ring);
  PERFORM pg_temp.ft_logout();
  SELECT * INTO v_f FROM public.geofences WHERE id = v_id;
  PERFORM pg_temp.ft_assert(v_f.is_active AND v_f.warning_buffer_meters = 30 AND v_f.created_by = v_admin
                            AND ST_NPoints(v_f.coordinates) = 5 AND ST_SRID(v_f.coordinates) = 4326,
    'a new fence: active, 30 m buffer, ring closed, SRID 4326, created_by set');
  PERFORM pg_temp.ft_assert(abs(ST_X(ST_PointN(ST_ExteriorRing(v_f.coordinates), 2)) - 122.601) < 1e-9,
    'ring points keep their order and [lng, lat] meaning');

  PERFORM pg_temp.ft_login(v_admin);
  PERFORM public.upsert_geofence(v_id, NULL, NULL, false, 12);
  PERFORM pg_temp.ft_logout();
  SELECT * INTO v_f FROM public.geofences WHERE id = v_id;
  PERFORM pg_temp.ft_assert(v_f.name = 'TEST RPC' AND NOT v_f.is_active AND v_f.warning_buffer_meters = 12
                            AND ST_NPoints(v_f.coordinates) = 5,
    'update with NULL name/ring keeps them, and changes what was passed');
  PERFORM pg_temp.ft_login(v_admin);
  PERFORM public.upsert_geofence(v_id, 'TEST RPC 2', NULL);
  PERFORM pg_temp.ft_logout();
  SELECT * INTO v_f FROM public.geofences WHERE id = v_id;
  PERFORM pg_temp.ft_assert(v_f.name = 'TEST RPC 2' AND NOT v_f.is_active AND v_f.warning_buffer_meters = 12,
    'update with only a name keeps is_active and buffer');

  v_ok := false;
  BEGIN
    PERFORM pg_temp.ft_login(v_admin);
    PERFORM public.upsert_geofence(NULL, 'TEST bow-tie',
      '[[122.6, 10.6], [122.601, 10.601], [122.601, 10.6], [122.6, 10.601], [122.6, 10.6]]'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'a self-crossing (bow-tie) outline is rejected');

  v_ok := false;
  BEGIN
    PERFORM pg_temp.ft_login(v_admin);
    PERFORM public.upsert_geofence(gen_random_uuid(), 'nope', NULL);
  EXCEPTION WHEN no_data_found THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'updating a fence id that does not exist is an error');

  IF v_staff IS NOT NULL THEN
    v_ok := false;
    BEGIN
      PERFORM pg_temp.ft_login(v_staff);
      PERFORM public.upsert_geofence(NULL, 'TEST staff', v_ring);
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := true;
    END;
    PERFORM pg_temp.ft_logout();
    PERFORM pg_temp.ft_assert(v_ok, 'staff cannot create fences');
  END IF;

  -- get_geofences_geojson keeps its shape for a signed-in user.
  PERFORM pg_temp.ft_login(v_admin);
  v_geo := public.get_geofences_geojson();
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(
    (SELECT e ? 'id' AND e ? 'name' AND e ? 'is_active' AND e ? 'warning_buffer_meters' AND e ? 'created_by'
            AND e -> 'coordinates' ->> 'type' = 'Polygon'
     FROM jsonb_array_elements(v_geo) e WHERE e ->> 'id' = v_id::text),
    'get_geofences_geojson returns id, name, is_active, warning_buffer_meters, created_by, GeoJSON coordinates');
END $$;

-- -----------------------------------------------------------------------------
-- 13. What the public anon key and a signed-in user may do
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_user  uuid := COALESCE(pg_temp.ft_get('staff'), pg_temp.ft_get('admin'))::uuid;
  v_other uuid := pg_temp.ft_get('admin')::uuid;
  v_alert uuid;
  v_ok    boolean;
  v_n     integer;
  v_body  text;   -- how to read net.http_request_queue.body as text
BEGIN
  -- anon: no positions, no fences, no tables.
  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM public.latest_livestock_locations;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'anon cannot read latest_livestock_locations');

  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.get_geofences_geojson();
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'anon cannot call get_geofences_geojson');

  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM public.livestock;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'anon cannot read the livestock table');

  -- Each lock on its own (the behaviour above holds even if one is lost).
  PERFORM pg_temp.ft_assert(NOT has_table_privilege('anon', 'public.latest_livestock_locations', 'SELECT'),
    'anon holds no SELECT grant on latest_livestock_locations');
  PERFORM pg_temp.ft_assert(
    (SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
     WHERE oid = 'public.latest_livestock_locations'::regclass),
    'latest_livestock_locations is security_invoker');
  PERFORM pg_temp.ft_assert(NOT has_function_privilege('anon', 'public.get_geofences_geojson()', 'EXECUTE')
                            AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_geofences_geojson()'::regprocedure),
    'get_geofences_geojson is SECURITY INVOKER and not executable by anon');
  PERFORM pg_temp.ft_assert(has_function_privilege('anon', 'public.ingest_telemetry(text,jsonb)', 'EXECUTE'),
    'anon keeps EXECUTE on ingest_telemetry (the gateway needs it)');
  PERFORM pg_temp.ft_assert(NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['profiles', 'collars', 'livestock', 'geofences', 'gateways',
                                 'location_logs', 'alerts', 'farm_settings', 'push_tokens']) t
      WHERE has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')),
    'anon holds no privileges on any FarmTrack table');

  -- The API guard refuses the PostGIS system tables for API roles.
  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.path', '/spatial_ref_sys', true);
    PERFORM public.farmtrack_pre_request();
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'farmtrack_pre_request refuses /spatial_ref_sys for anon');

  v_ok := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.path', '/spatial%5fref%5fsys', true);
    PERFORM public.farmtrack_pre_request();
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'farmtrack_pre_request refuses a percent-encoded path (/spatial%5fref%5fsys)');

  -- Normal paths still pass (these calls raise if they are refused).
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.path', '/rpc/ingest_telemetry', true);
  PERFORM public.farmtrack_pre_request();
  PERFORM pg_temp.ft_logout();
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.path', '/livestock', true);
  PERFORM public.farmtrack_pre_request();
  PERFORM set_config('request.path', '', true);
  PERFORM pg_temp.ft_logout();

  IF v_user IS NULL THEN
    RAISE NOTICE 'signed-in user tests skipped: no accounts';
    RETURN;
  END IF;

  -- A signed-in user sees the map view.
  PERFORM pg_temp.ft_login(v_user);
  SELECT count(*) INTO v_n FROM public.latest_livestock_locations WHERE tag_id LIKE 'TEST-FT-7E57%';
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_n >= 10, 'a signed-in user reads latest_livestock_locations');
  PERFORM pg_temp.ft_assert(
    (SELECT sats = 9 AND last_ping_at IS NOT NULL AND last_seen_at IS NOT NULL AND latitude IS NOT NULL
     FROM public.latest_livestock_locations WHERE tag_id = 'TEST-FT-7E570501'),
    'the view has position, last_seen_at, last_ping_at and sats');

  -- Resolving an alert stamps who did it; nothing else about the alert can change.
  SELECT id INTO v_alert FROM public.alerts
  WHERE status = 'unresolved' AND livestock_id IN (SELECT id FROM public.livestock WHERE tag_id LIKE 'TEST-%')
  LIMIT 1;
  PERFORM pg_temp.ft_assert(v_alert IS NOT NULL, 'setup: an open test alert exists');
  PERFORM pg_temp.ft_login(v_user);
  UPDATE public.alerts SET status = 'resolved', resolved_by = gen_random_uuid() WHERE id = v_alert;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(
    (SELECT status = 'resolved' AND resolved_by = v_user AND resolved_at = now() FROM public.alerts WHERE id = v_alert),
    'resolving sets resolved_by to the user who did it (not what the app sent)');

  v_ok := false;
  BEGIN
    PERFORM pg_temp.ft_login(v_user);
    UPDATE public.alerts SET alert_type = 'info' WHERE id = v_alert;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'a signed-in user cannot rewrite an alert''s type');

  v_ok := false;
  BEGIN
    PERFORM pg_temp.ft_login(v_user);
    UPDATE public.profiles SET role = 'admin' WHERE id = v_user;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'a signed-in user cannot change their own role');

  PERFORM pg_temp.ft_login(v_user);
  UPDATE public.profiles SET farm_name = 'TEST farm' WHERE id = v_user;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert((SELECT farm_name FROM public.profiles WHERE id = v_user) = 'TEST farm',
    'a signed-in user can rename their farm');

  -- Push tokens: register through the RPC; a phone that changes user moves over.
  PERFORM pg_temp.ft_login(v_user);
  PERFORM public.register_push_token('ExponentPushToken[farmtrack-test-token]', 'android');
  SELECT count(*) INTO v_n FROM public.push_tokens WHERE token = 'ExponentPushToken[farmtrack-test-token]';
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_n = 1, 'register_push_token stores the token for the signed-in user');
  IF v_other IS NOT NULL AND v_other <> v_user THEN
    PERFORM pg_temp.ft_login(v_other);
    PERFORM public.register_push_token('ExponentPushToken[farmtrack-test-token]', 'ios');
    PERFORM pg_temp.ft_logout();
    PERFORM pg_temp.ft_assert(
      (SELECT profile_id = v_other FROM public.push_tokens WHERE token = 'ExponentPushToken[farmtrack-test-token]'),
      'the same phone signed in as another user takes the token over');
    PERFORM pg_temp.ft_login(v_user);
    PERFORM public.register_push_token('ExpoPushToken[farmtrack-test-token-2]', 'android');
    SELECT count(*) INTO v_n FROM public.push_tokens
    WHERE token IN ('ExponentPushToken[farmtrack-test-token]', 'ExpoPushToken[farmtrack-test-token-2]');
    PERFORM pg_temp.ft_logout();
    PERFORM pg_temp.ft_assert(v_n = 1, 'a user sees only their own push tokens (1 of the 2 test tokens)');
  END IF;

  v_ok := false;
  BEGIN
    PERFORM pg_temp.ft_login(v_user);
    PERFORM public.register_push_token('not a token', 'android');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_ok := true;
  END;
  PERFORM pg_temp.ft_logout();
  PERFORM pg_temp.ft_assert(v_ok, 'register_push_token rejects something that is not an Expo token');

  -- A breach alert still inserts with a push token registered, and, where
  -- pg_net is installed and readable, queues exactly one request carrying the
  -- test token (uncommitted, so pg_net's worker never sees or sends it).
  PERFORM pg_temp.ft_ingest(jsonb_build_array(pg_temp.ft_r('FT-7E570501', 30, pg_temp.ft_ts(30), -60)));
  PERFORM pg_temp.ft_assert(pg_temp.ft_alerts((SELECT id FROM public.livestock WHERE tag_id = 'TEST-FT-7E570501'),
                                              'boundary_breach', 'unresolved') = 1,
    'a breach alert is created while a push token is registered');
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    IF has_table_privilege('net.http_request_queue', 'SELECT') THEN
      SELECT CASE WHEN data_type = 'bytea' THEN 'convert_from(body, ''UTF8'')' ELSE 'body::text' END
        INTO v_body
      FROM information_schema.columns
      WHERE table_schema = 'net' AND table_name = 'http_request_queue' AND column_name = 'body';
      EXECUTE format('SELECT count(*) FROM net.http_request_queue WHERE %s LIKE %L',
                     v_body, '%farmtrack-test-token%')
        INTO v_n;
      PERFORM pg_temp.ft_assert(v_n = 1,
        'the breach alert queued exactly one push request to the test phones, got ' || v_n);
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 14. Retention: rows older than 30 days are thinned to one per minute
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_collar uuid;
  v_base   timestamptz := date_trunc('minute', now() - interval '40 days');
  v_before integer;
BEGIN
  INSERT INTO public.collars (device_hardware_id) VALUES ('FT-7E571401') RETURNING id INTO v_collar;
  INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", seq)
  SELECT v_collar, 10.5, 122.5, v_base + s * interval '5 seconds', s FROM generate_series(0, 23) s;  -- 2 minutes
  INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", seq)
  SELECT v_collar, 10.5, 122.5, now() - s * interval '5 seconds', 100 + s FROM generate_series(1, 5) s;
  v_before := pg_temp.ft_rows('FT-7E571401');
  PERFORM public.downsample_location_logs();
  PERFORM pg_temp.ft_assert(v_before = 29 AND pg_temp.ft_rows('FT-7E571401') = 2 + 5,
    'old rows thinned to one per minute (24 -> 2); recent rows untouched');
END $$;

ROLLBACK;

-- Only reached when every block above passed. Names any check that could
-- not run here (decided by the same conditions the blocks above used).
SELECT 'ALL TESTS PASSED'
       || COALESCE(' (skipped: ' || NULLIF(concat_ws('; ',
            CASE WHEN NOT has_table_privilege('auth.users', 'INSERT')
                 THEN 'sign-up test - this role cannot insert into auth.users' END,
            CASE WHEN NOT has_table_privilege('auth.users', 'INSERT')
                      AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin')
                 THEN 'fence RPC and signed-in user tests - no accounts'
                 WHEN NOT has_table_privilege('auth.users', 'INSERT')
                      AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'staff')
                 THEN '"staff cannot create fences" and push-token takeover - no staff account' END,
            CASE WHEN to_regclass('net.http_request_queue') IS NULL
                 THEN 'push queue check - pg_net is not installed'
                 WHEN NOT has_table_privilege('net.http_request_queue', 'SELECT')
                 THEN 'push queue check - no SELECT on net.http_request_queue' END
          ), '') || ')', '')
       AS result;
