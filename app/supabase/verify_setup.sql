-- =============================================================================
-- FarmTrack: is the database actually set up?
--
-- Paste the whole file into the Supabase SQL editor and run it. It only reads
-- catalog metadata and row counts - it writes nothing and returns no secrets.
--
-- Read the `status` column: OK means that piece is in place, INFO rows are
-- there to be read rather than passed. Anything else is the thing to go fix.
--
-- Every column this query touches has been checked against the live database,
-- so it should run as-is. Rows 20-29 print the real shape of public.gateways,
-- because that table is NOT the one described by gateway_ingest.sql in this
-- folder - it was created separately and has its own columns.
-- =============================================================================

SELECT * FROM (

  -- --- extensions ----------------------------------------------------------
  SELECT 1 AS ord, 'extension: postgis' AS item,
         CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
              THEN 'OK' ELSE 'MISSING' END AS status,
         '' AS detail
  UNION ALL
  SELECT 2, 'extension: pgcrypto',
         CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto')
              THEN 'OK' ELSE 'MISSING - ingest_telemetry cannot run' END,
         'required: the key check calls digest(p_gateway_key, ''sha256'')'

  -- --- tables --------------------------------------------------------------
  UNION ALL
  SELECT 3, 'table: ' || t,
         CASE WHEN to_regclass('public.' || t) IS NOT NULL THEN 'OK' ELSE 'MISSING' END, ''
  FROM unnest(ARRAY['profiles','collars','livestock','geofences',
                    'location_logs','alerts','gateways']) AS t

  -- --- telemetry columns on location_logs ----------------------------------
  UNION ALL
  SELECT 4, 'location_logs.' || c,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'location_logs' AND column_name = c
         ) THEN 'OK' ELSE 'MISSING' END, ''
  FROM unnest(ARRAY['seq','rssi','snr','gateway_id']) AS c

  -- --- the ingest function -------------------------------------------------
  -- The detail column prints the real signature, so you can confirm the
  -- parameter names match what gateway.cpp posts: p_gateway_key, p_readings.
  UNION ALL
  SELECT 5, 'rpc: ingest_telemetry',
         COALESCE((
           SELECT 'OK'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'ingest_telemetry' LIMIT 1
         ), 'MISSING'),
         COALESCE((
           SELECT 'args(' || pg_get_function_arguments(p.oid) || ')'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'ingest_telemetry' LIMIT 1
         ), '')

  UNION ALL
  -- Must be SECURITY DEFINER: the gateway calls in as `anon`, and RLS on
  -- location_logs only lets admins insert.
  SELECT 6, 'ingest_telemetry is SECURITY DEFINER',
         COALESCE((
           SELECT CASE WHEN p.prosecdef THEN 'OK'
                       ELSE 'NO - inserts will be blocked by RLS' END
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'ingest_telemetry' LIMIT 1
         ), 'MISSING'),
         COALESCE((
           SELECT 'returns ' || pg_get_function_result(p.oid)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'ingest_telemetry' LIMIT 1
         ), '')

  UNION ALL
  -- gateway.cpp sends only the anon key, so anon must hold EXECUTE.
  SELECT 7, 'anon can EXECUTE ingest_telemetry',
         COALESCE((
           SELECT CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE')
                       THEN 'OK' ELSE 'NO - gateway gets 401/403' END
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'ingest_telemetry' LIMIT 1
         ), 'MISSING'), ''

  -- --- row level security --------------------------------------------------
  UNION ALL
  SELECT 8, 'RLS on ' || c.relname,
         CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'OFF - table is world readable' END, ''
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('profiles','collars','livestock','geofences',
                      'location_logs','alerts','gateways')

  -- --- data the pipeline depends on ----------------------------------------
  -- No is_active filter here: this gateways table does not have that column.
  UNION ALL
  SELECT 10, 'registered gateways',
         CASE WHEN COUNT(*) > 0 THEN 'OK'
              ELSE 'NONE - every upload will be rejected' END,
         COUNT(*) || ' row(s), last seen: ' ||
         COALESCE(MAX(last_seen_at)::TEXT, 'never')
  FROM public.gateways

  UNION ALL
  SELECT 11, 'active geofences',
         CASE WHEN COUNT(*) > 0 THEN 'OK'
              ELSE 'NONE - collars will always read state 0 (safe)' END,
         COUNT(*) || ' active'
  FROM public.geofences WHERE is_active

  UNION ALL
  -- An unpaired collar is logged and mapped, but detect_geofence_events()
  -- bails out early for it, so it never warns or breaches.
  SELECT 12, 'collars paired to livestock',
         CASE WHEN COUNT(*) FILTER (WHERE l.id IS NOT NULL) > 0 THEN 'OK'
              ELSE 'NONE PAIRED - no alerts will ever fire' END,
         COUNT(*) FILTER (WHERE l.id IS NOT NULL) || ' of ' || COUNT(*) || ' collars paired'
  FROM public.collars c
  LEFT JOIN public.livestock l ON l.collar_id = c.id

  UNION ALL
  SELECT 13, 'telemetry arriving',
         CASE WHEN COUNT(*) > 0 THEN 'OK - data is flowing'
              ELSE 'no readings in the last hour' END,
         COUNT(*) || ' location_logs rows in the last hour'
  FROM public.location_logs WHERE timestamp > NOW() - INTERVAL '1 hour'

  -- --- preconditions the deployed ingest_telemetry body depends on ---------
  -- It runs: ON CONFLICT (collar_id, seq, timestamp) DO NOTHING
  -- Postgres requires a UNIQUE index on exactly those columns; without one
  -- every GPS insert aborts with 42P10 and the whole call fails.
  UNION ALL
  SELECT 14, 'unique index on location_logs (collar_id, seq, timestamp)',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'location_logs'
             AND indexdef ILIKE '%UNIQUE%'
             AND indexdef ILIKE '%collar_id%'
             AND indexdef ILIKE '%seq%'
             AND indexdef ILIKE '%timestamp%'
         ) THEN 'OK' ELSE 'MISSING - every GPS reading will fail (42P10)' END, ''

  UNION ALL
  -- It also sets collars.connection_type = 'LoRa'. schema.sql declares that
  -- enum as ('LTE','Satellite') only, so if 'LoRa' was never added the UPDATE
  -- throws invalid_text_representation on every single upload.
  SELECT 15, 'connection_type enum includes ''LoRa''',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'connection_type' AND e.enumlabel = 'LoRa'
         ) THEN 'OK' ELSE 'MISSING - every upload raises invalid enum value' END,
         COALESCE((
           SELECT 'values: ' || string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'connection_type'
         ), '')

  UNION ALL
  -- Printed so you can eyeball what the ON CONFLICT above can actually match.
  SELECT 16, 'location_logs index: ' || indexname, 'INFO', indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'location_logs'

  -- --- what public.gateways actually looks like ----------------------------
  -- Printed rather than assumed. Whichever column holds the shared secret,
  -- its name shows up here.
  UNION ALL
  SELECT 20, 'gateways column: ' || column_name, 'INFO',
         data_type || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'gateways'

) report ORDER BY ord, item;


-- =============================================================================
-- Gateway secret: how this database actually checks it
--
-- The deployed ingest_telemetry looks the gateway up with:
--
--   SELECT id FROM gateways
--   WHERE api_key_hash = encode(digest(p_gateway_key, 'sha256'), 'hex');
--
-- So api_key_hash holds an unsalted lowercase-hex SHA-256 of the plaintext
-- secret, and GATEWAY_SECRET in firmware/src/secrets.h must be that exact
-- plaintext - any string, no particular format.
--
-- Is a given secret already registered? One row back means the gateway will
-- authenticate; zero rows means it will not.
-- =============================================================================

-- SELECT id, name, last_seen_at
-- FROM public.gateways
-- WHERE api_key_hash = encode(digest('PASTE_YOUR_GATEWAY_SECRET_HERE', 'sha256'), 'hex');

-- Register a new gateway, or rotate an existing one's key:
--
-- INSERT INTO public.gateways (name, api_key_hash)
-- VALUES ('Barn Gateway',
--         encode(digest('PASTE_YOUR_GATEWAY_SECRET_HERE', 'sha256'), 'hex'));
--
-- UPDATE public.gateways
-- SET api_key_hash = encode(digest('NEW_SECRET_HERE', 'sha256'), 'hex')
-- WHERE name = 'Barn Gateway';
--
-- Note: unsalted SHA-256 is fast to brute-force, so a short or guessable
-- secret is weak even though it is stored hashed. Use a long random string.
-- To re-print the function body if you want to re-read it:
--
-- SELECT p.prosrc
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'ingest_telemetry';


-- =============================================================================
-- End-to-end test with no hardware powered on.
--
-- Use your real gateway secret and a coordinate inside one of your fences.
-- Expect one row back: the device id, and a state of 0 (safe), 1 (warning) or
-- 2 (breach). This DOES write a location_logs row and may fire an alert - it
-- is exactly the call the gateway makes.
-- =============================================================================

-- SELECT * FROM public.ingest_telemetry(
--   'PASTE_YOUR_GATEWAY_SECRET_HERE',
--   '[{"device_id":"FT-DEADBEEF","seq":1,"ts":0,"fix":true,
--      "lat":14.5995,"lng":120.9842,"battery":85,"rssi":-70,"snr":9.0}]'::jsonb
-- );
