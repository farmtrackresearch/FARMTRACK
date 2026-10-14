-- Run after migrations/20261013_latest_livestock_locations.sql or schema.sql.
-- All fixtures and any trigger-generated alerts/push requests roll back.
BEGIN;

DO $$
DECLARE
  v_collar uuid := gen_random_uuid();
  v_no_fix_collar uuid := gen_random_uuid();
  v_animal uuid := gen_random_uuid();
  v_no_fix_animal uuid := gen_random_uuid();
  v_unpaired_animal uuid := gen_random_uuid();
  v_base timestamptz := now() - interval '1 minute';
  v_position record;
BEGIN
  INSERT INTO public.collars (id, device_hardware_id, last_ping_at)
  VALUES (v_collar, 'FT-' || upper(left(replace(v_collar::text, '-', ''), 8)), now()),
         (v_no_fix_collar, 'FT-' || upper(left(replace(v_no_fix_collar::text, '-', ''), 8)), now());
  INSERT INTO public.livestock (id, tag_id, name, breed, collar_id)
  VALUES (v_animal, 'LOCATION-TEST-' || v_animal, 'Moving test animal', 'Test', v_collar),
         (v_no_fix_animal, 'LOCATION-TEST-' || v_no_fix_animal, 'No-fix test animal', 'Test', v_no_fix_collar),
         (v_unpaired_animal, 'LOCATION-TEST-' || v_unpaired_animal, 'Unpaired test animal', 'Test', NULL);

  -- Five small movements: the view must return the last fix, not their average.
  INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", received_at, seq, sats)
  SELECT v_collar, 10.5 + n * 0.000005, 122.5 + n * 0.000005,
         v_base + n * interval '3 seconds', v_base + n * interval '3 seconds', n, 4 + n
  FROM generate_series(0, 4) n;
  SELECT * INTO v_position FROM public.latest_livestock_locations WHERE livestock_id = v_animal;
  IF abs(v_position.latitude - 10.50002) > 1e-10
     OR abs(v_position.longitude - 122.50002) > 1e-10
     OR v_position.last_seen_at IS DISTINCT FROM v_base + interval '12 seconds'
     OR v_position.sats IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'TEST FAILED: newest coordinates, fix time and satellites must come from one latest row';
  END IF;

  -- A backlog arriving now must not displace a more recent GPS fix.
  INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", received_at, seq, sats)
  VALUES (v_collar, 10.4, 122.4, v_base - interval '10 minutes', now(), 100, 4);
  SELECT * INTO v_position FROM public.latest_livestock_locations WHERE livestock_id = v_animal;
  IF abs(v_position.latitude - 10.50002) > 1e-10 THEN
    RAISE EXCEPTION 'TEST FAILED: late upload replaced the newest GPS fix';
  END IF;

  -- Equal GPS times are resolved by receipt time; NULL receipt times sort last.
  INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", received_at, seq, sats)
  VALUES (v_collar, 10.50003, 122.50003, v_base + interval '12 seconds', now(), 101, 9),
         (v_collar, 10.4, 122.4, v_base + interval '12 seconds', NULL, 102, 4);
  SELECT * INTO v_position FROM public.latest_livestock_locations WHERE livestock_id = v_animal;
  IF abs(v_position.latitude - 10.50003) > 1e-10 OR v_position.sats IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'TEST FAILED: equal-time fix ordering is not deterministic';
  END IF;

  SELECT * INTO v_position FROM public.latest_livestock_locations WHERE livestock_id = v_no_fix_animal;
  IF NOT FOUND OR v_position.latitude IS NOT NULL OR v_position.longitude IS NOT NULL
     OR v_position.last_seen_at IS NOT NULL OR v_position.last_ping_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: reporting collar without a GPS fix must retain its heartbeat and empty position';
  END IF;
  SELECT * INTO v_position FROM public.latest_livestock_locations WHERE livestock_id = v_unpaired_animal;
  IF NOT FOUND OR v_position.collar_id IS NOT NULL OR v_position.latitude IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: unpaired animal must remain visible without a position';
  END IF;
  IF NOT (SELECT reloptions @> ARRAY['security_invoker=true']
          FROM pg_class WHERE oid = 'public.latest_livestock_locations'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: view must retain security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.latest_livestock_locations', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED: anonymous users must not gain access to the view';
  END IF;
END $$;

ROLLBACK;
SELECT 'LATEST LOCATION TESTS PASSED' AS result;
