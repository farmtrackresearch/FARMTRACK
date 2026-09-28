-- =============================================================================
-- FarmTrack: step 3 of 4 - is the database set up correctly?
--
-- Supabase -> SQL Editor -> paste this whole file -> Run.
-- It only reads catalog data and counts. It changes nothing and returns no
-- positions, keys or key hashes.
--
-- Read the `status` column:
--   OK    that piece is in place
--   INFO  a fact to read, not a pass/fail
--   anything else says what is wrong; the `detail` column says what to do.
-- After schema.sql, every row other than INFO should say OK.
-- It also runs on an older database (rows then say MISSING) - useful to see
-- what schema.sql will change.
-- =============================================================================

WITH
fn AS (   -- FarmTrack's own functions (not PostGIS or other extensions)
  SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.prorettype
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
),
tbl(t) AS (
  VALUES ('profiles'), ('collars'), ('livestock'), ('geofences'), ('location_logs'),
         ('alerts'), ('gateways'), ('farm_settings'), ('push_tokens')
),
trg(tab, name) AS (
  VALUES ('public.location_logs', 'location_logs_detect_events'),
         ('public.location_logs', 'location_logs_sync_point'),
         ('public.alerts',        'alerts_set_resolution'),
         ('public.alerts',        'alerts_push_notify'),
         ('auth.users',           'on_auth_user_created')
),
pre AS (  -- PostgREST pre-request setting on the authenticator role
  SELECT substring(cfg FROM '^pgrst\.db_pre_request=(.*)$') AS value
  FROM pg_db_role_setting s
  CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
  WHERE s.setrole = (SELECT oid FROM pg_roles WHERE rolname = 'authenticator')
    AND s.setdatabase = 0
    AND cfg LIKE 'pgrst.db_pre_request=%'
),
srs AS (
  SELECT c.oid, n.nspname, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'spatial_ref_sys' AND c.relkind = 'r'
  LIMIT 1
)
SELECT ord, item, status, detail FROM (

  -- --- extensions -------------------------------------------------------------
  SELECT 1 AS ord, 'extension: ' || x AS item,
         CASE WHEN e.extname IS NOT NULL THEN 'OK'
              WHEN x IN ('postgis', 'pgcrypto') THEN 'MISSING - run schema.sql'
              ELSE 'MISSING' END AS status,
         CASE WHEN e.extname IS NOT NULL THEN 'schema ' || e.extnamespace::regnamespace::text
              WHEN x = 'pg_net'  THEN 'push notifications are off: Database -> Extensions -> pg_net, then run schema.sql again'
              WHEN x = 'pg_cron' THEN 'history is not downsampled: Database -> Extensions -> pg_cron, then run schema.sql again'
              ELSE '' END AS detail
  FROM unnest(ARRAY['postgis', 'pgcrypto', 'pg_net', 'pg_cron']) AS x
  LEFT JOIN pg_extension e ON e.extname = x

  UNION ALL
  SELECT 2, 'retention job farmtrack-downsample-location-logs',
         CASE WHEN to_regclass('cron.job') IS NULL THEN 'MISSING - pg_cron not installed'
              WHEN NOT has_table_privilege('cron.job', 'SELECT') THEN 'CANNOT CHECK - no access to cron.job'
              WHEN (xpath('/row/n/text()', query_to_xml(
                     'SELECT count(*) AS n FROM cron.job WHERE jobname = ''farmtrack-downsample-location-logs''',
                     false, true, '')))[1]::text::int > 0 THEN 'OK'
              ELSE 'MISSING - run schema.sql again' END,
         'daily 19:17 UTC: thins location_logs older than 30 days to one row per minute'

  -- --- tables, RLS, columns -----------------------------------------------------
  UNION ALL
  SELECT 10, 'table: ' || t,
         CASE WHEN to_regclass('public.' || t) IS NULL THEN 'MISSING - run schema.sql'
              WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN 'OK'
              ELSE 'RLS OFF - table is open to the API' END,
         CASE WHEN to_regclass('public.' || t) IS NULL THEN '' ELSE 'row level security on' END
  FROM tbl

  UNION ALL
  SELECT 11, 'location_logs.' || c,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'location_logs' AND column_name = c)
              THEN 'OK' ELSE 'MISSING - run schema.sql' END,
         CASE c WHEN 'received_at' THEN 'server receipt time ("timestamp" is the fix time)' ELSE '' END
  FROM unnest(ARRAY['seq', 'rssi', 'snr', 'gateway_id', 'sats', 'received_at']) AS c

  UNION ALL
  SELECT 12, 'collars.battery_level allows NULL (= unknown)',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'collars' AND column_name = 'battery_level') = 'YES'
              THEN 'OK' ELSE 'NO - run schema.sql' END, ''

  UNION ALL
  SELECT 13, 'connection_type enum includes ''LoRa''',
         CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                           WHERE t.typname = 'connection_type' AND e.enumlabel = 'LoRa')
              THEN 'OK' ELSE 'MISSING - run 00_enum_values.sql' END, ''

  UNION ALL
  SELECT 14, 'unique index location_logs (collar_id, seq, timestamp)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_index i
                           WHERE i.indrelid = to_regclass('public.location_logs') AND i.indisunique
                             AND pg_get_indexdef(i.indexrelid) LIKE '%(collar_id, seq, "timestamp")%')
              THEN 'OK' ELSE 'MISSING - re-sent readings would be stored twice' END, ''

  UNION ALL
  SELECT 15, 'index alerts (livestock_id, alert_type, status)',
         CASE WHEN to_regclass('public.alerts_livestock_type_status_idx') IS NOT NULL
              THEN 'OK' ELSE 'MISSING - run schema.sql' END, ''

  UNION ALL
  SELECT 16, 'deleting a collar cannot erase its history (FK RESTRICT)',
         COALESCE((SELECT CASE WHEN bool_and(confdeltype = 'r') THEN 'OK'
                               ELSE 'NO - collar delete cascades to location_logs' END
                   FROM pg_constraint
                   WHERE conrelid = to_regclass('public.location_logs') AND contype = 'f'
                     AND confrelid = to_regclass('public.collars')), 'MISSING'), ''

  UNION ALL
  SELECT 17, 'check: location_logs.' || x || ' in range',
         COALESCE((SELECT 'OK' FROM pg_constraint WHERE conname = 'location_logs_' || x || '_range'),
                  'MISSING - run schema.sql'),
         COALESCE((SELECT CASE WHEN convalidated THEN 'validated'
                               ELSE 'applies to new rows; some old rows are out of range' END
                   FROM pg_constraint WHERE conname = 'location_logs_' || x || '_range'), '')
  FROM unnest(ARRAY['latitude', 'longitude']) AS x

  -- --- functions ------------------------------------------------------------------
  UNION ALL
  SELECT 20, 'rpc: ' || f,
         CASE WHEN to_regprocedure('public.' || f) IS NOT NULL THEN 'OK' ELSE 'MISSING - run schema.sql' END,
         COALESCE('returns ' || pg_get_function_result(to_regprocedure('public.' || f)), '')
  FROM unnest(ARRAY['ingest_telemetry(text,jsonb)', 'upsert_geofence(uuid,text,jsonb,boolean,numeric)',
                    'get_geofences_geojson()', 'set_collars_muted(integer)',
                    'register_push_token(text,text)', 'downsample_location_logs()']) AS f

  UNION ALL
  SELECT 21, 'ingest_telemetry is contract v2 (RETURNS jsonb, SECURITY DEFINER)',
         COALESCE((SELECT CASE WHEN NOT prosecdef THEN 'NO - gateway inserts would be blocked by RLS'
                               WHEN prorettype <> 'jsonb'::regtype THEN 'NO - must return jsonb'
                               WHEN prosrc NOT LIKE '%first_ord%' THEN 'OLD VERSION - run schema.sql'
                               ELSE 'OK' END
                   FROM pg_proc WHERE oid = to_regprocedure('public.ingest_telemetry(text,jsonb)')), 'MISSING'), ''

  UNION ALL
  SELECT 22, 'anon can EXECUTE ingest_telemetry (the gateway)',
         COALESCE(CASE WHEN has_function_privilege('anon', to_regprocedure('public.ingest_telemetry(text,jsonb)'), 'EXECUTE')
                       THEN 'OK' ELSE 'NO - the gateway gets 401/403' END, 'MISSING'), ''

  UNION ALL
  SELECT 23, 'anon can EXECUTE nothing else',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'NO - anon can call: ' || string_agg(proname, ', ') END, ''
  FROM fn
  WHERE fn.proname NOT IN ('ingest_telemetry', 'farmtrack_pre_request')
    AND fn.prorettype <> 'trigger'::regtype
    AND has_function_privilege('anon', fn.oid, 'EXECUTE')

  UNION ALL
  SELECT 24, 'search_path pinned: ' || proname || '()',
         CASE WHEN EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')
              THEN 'OK' ELSE 'NO - SECURITY DEFINER without a fixed search_path' END,
         COALESCE((SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'), '')
  FROM fn WHERE prosecdef

  -- --- the security holes found in review ---------------------------------------
  UNION ALL
  SELECT 30, 'a user cannot change their own role',
         CASE WHEN to_regclass('public.profiles') IS NULL THEN 'MISSING'
              WHEN has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
              THEN 'NO - any user can make themselves admin' ELSE 'OK' END, ''

  UNION ALL
  SELECT 31, 'sign-up always creates staff (role not read from metadata)',
         COALESCE((SELECT CASE WHEN pg_get_functiondef(oid) ILIKE '%raw_user_meta_data%''role''%'
                               THEN 'NO - sign-up can request admin' ELSE 'OK' END
                   FROM fn WHERE proname = 'handle_new_user'), 'MISSING'), ''

  UNION ALL
  SELECT 32, 'anon cannot read latest_livestock_locations',
         CASE WHEN to_regclass('public.latest_livestock_locations') IS NULL THEN 'MISSING'
              WHEN has_table_privilege('anon', 'public.latest_livestock_locations', 'SELECT')
              THEN 'NO - the public key can read every animal''s position' ELSE 'OK' END, ''

  UNION ALL
  SELECT 33, 'latest_livestock_locations is security_invoker',
         COALESCE((SELECT CASE WHEN 'security_invoker=true' = ANY (reloptions) THEN 'OK'
                               ELSE 'NO - the view bypasses RLS' END
                   FROM pg_class WHERE oid = to_regclass('public.latest_livestock_locations')), 'MISSING'), ''

  UNION ALL
  SELECT 34, 'get_geofences_geojson: invoker, not callable by anon',
         COALESCE((SELECT CASE WHEN has_function_privilege('anon', oid, 'EXECUTE') THEN 'NO - anon can read the fences'
                               WHEN prosecdef THEN 'NO - SECURITY DEFINER bypasses RLS'
                               ELSE 'OK' END
                   FROM fn WHERE proname = 'get_geofences_geojson'), 'MISSING'), ''

  UNION ALL
  SELECT 35, 'a user can only resolve alerts (not rewrite them)',
         CASE WHEN to_regclass('public.alerts') IS NULL THEN 'MISSING'
              WHEN has_column_privilege('authenticated', 'public.alerts', 'alert_type', 'UPDATE')
                OR has_column_privilege('authenticated', 'public.alerts', 'description', 'UPDATE')
              THEN 'NO - users can rewrite alert contents'
              WHEN NOT has_column_privilege('authenticated', 'public.alerts', 'status', 'UPDATE')
              THEN 'NO - users cannot resolve alerts'
              ELSE 'OK' END, ''

  UNION ALL
  SELECT 36, 'anon holds no privileges on FarmTrack tables',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'NO - ' || string_agg(t, ', ') END,
         'RLS already hides every row from anon; this is the second lock'
  FROM tbl
  WHERE to_regclass('public.' || t) IS NOT NULL
    AND has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')

  UNION ALL
  SELECT 37, 'API guard: pgrst.db_pre_request on authenticator',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pre) THEN 'MISSING - see README.md "PostGIS system tables"'
              WHEN (SELECT value FROM pre) <> 'public.farmtrack_pre_request'
              THEN 'OTHER - set to ' || (SELECT value FROM pre)
              WHEN to_regprocedure('public.farmtrack_pre_request()') IS NULL
              THEN 'BROKEN - the function is missing, every API request fails: run schema.sql now'
              WHEN NOT has_function_privilege('anon', 'public.farmtrack_pre_request()', 'EXECUTE')
                OR NOT has_function_privilege('authenticated', 'public.farmtrack_pre_request()', 'EXECUTE')
              THEN 'BROKEN - API roles cannot execute it: run schema.sql now'
              ELSE 'OK' END,
         'confirm with the curl test in README.md'

  UNION ALL
  SELECT 38, 'spatial_ref_sys cannot be changed through the API',
         CASE WHEN NOT EXISTS (SELECT 1 FROM srs) THEN 'MISSING - PostGIS not installed'
              WHEN NOT has_table_privilege('anon', (SELECT oid FROM srs), 'INSERT,UPDATE,DELETE') THEN 'OK'
              WHEN (SELECT value FROM pre) = 'public.farmtrack_pre_request' THEN 'OK'
              ELSE 'NO - the anon key can delete SRID 4326 and break every fence check' END,
         (SELECT CASE WHEN NOT has_table_privilege('anon', oid, 'INSERT,UPDATE,DELETE')
                      THEN 'anon has no write grant'
                      WHEN (SELECT value FROM pre) = 'public.farmtrack_pre_request'
                      THEN 'owned by ' || owner || ' in schema ' || nspname
                           || ', so its grants cannot be changed here; API requests to it are refused by farmtrack_pre_request'
                      ELSE 'owned by ' || owner || ' in schema ' || nspname || ': run schema.sql to add the API guard' END
          FROM srs)

  -- --- triggers and realtime --------------------------------------------------------
  UNION ALL
  SELECT 40, 'trigger: ' || trg.name,
         COALESCE((SELECT CASE WHEN tg.tgenabled = 'D' THEN 'DISABLED - ' ||
                                 CASE WHEN trg.name = 'location_logs_detect_events' THEN 'no fence state, no alerts'
                                      ELSE 'run schema.sql' END
                               ELSE 'OK' END
                   FROM pg_trigger tg
                   WHERE tg.tgrelid = to_regclass(trg.tab) AND tg.tgname = trg.name AND NOT tg.tgisinternal),
                  'MISSING - run schema.sql'),
         'on ' || trg.tab
  FROM trg

  UNION ALL
  SELECT 41, 'no unexpected triggers on location_logs / alerts',
         CASE WHEN count(*) = 0 THEN 'OK' ELSE 'EXTRA - ' || string_agg(tg.tgname, ', ') || ' (schema.sql removes them)' END, ''
  FROM pg_trigger tg
  WHERE tg.tgrelid IN (to_regclass('public.location_logs'), to_regclass('public.alerts'))
    AND NOT tg.tgisinternal
    AND tg.tgname NOT IN (SELECT name FROM trg)

  UNION ALL
  SELECT 42, 'realtime publishes ' || x,
         CASE WHEN EXISTS (SELECT 1 FROM pg_publication_tables
                           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = x)
              THEN 'OK' ELSE 'MISSING - the app will not update live' END, ''
  FROM unnest(ARRAY['alerts', 'collars', 'livestock', 'location_logs', 'geofences', 'farm_settings']) AS x

  -- --- data the pipeline depends on ---------------------------------------------------
  UNION ALL
  SELECT 50, 'registered gateways',
         CASE WHEN g.n IS NULL THEN 'MISSING - run schema.sql'
              WHEN g.n > 0 THEN 'OK' ELSE 'NONE - every upload is rejected (README.md: register a gateway)' END,
         COALESCE(g.n, 0) || ' gateway(s), last upload: ' || COALESCE(g.last_seen, 'never')
  FROM (SELECT (xpath('/row/n/text()', x))[1]::text::int AS n, (xpath('/row/l/text()', x))[1]::text AS last_seen
        FROM (SELECT CASE WHEN to_regclass('public.gateways') IS NOT NULL
                          THEN query_to_xml('SELECT count(*) AS n, max(last_seen_at) AS l FROM public.gateways',
                                            false, true, '') END AS x) q) g

  UNION ALL
  SELECT 51, 'active geofences',
         CASE WHEN count(*) > 0 THEN 'OK' ELSE 'NONE - every animal reads safe' END,
         count(*) || ' active'
  FROM public.geofences WHERE is_active

  UNION ALL
  SELECT 52, 'collars paired to livestock',
         CASE WHEN count(l.id) > 0 THEN 'OK' ELSE 'NONE PAIRED - no fence alerts will fire' END,
         count(l.id) || ' of ' || count(*) || ' collars paired'
  FROM public.collars c LEFT JOIN public.livestock l ON l.collar_id = c.id

  UNION ALL
  SELECT 53, 'farm_settings row (Emergency Disable)',
         CASE WHEN to_regclass('public.farm_settings') IS NULL THEN 'MISSING - run schema.sql'
              WHEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.farm_settings WHERE id = 1',
                                                         false, true, '')))[1]::text::int = 1 THEN 'OK'
              ELSE 'MISSING ROW - run schema.sql' END,
         CASE WHEN to_regclass('public.farm_settings') IS NULL THEN ''
              ELSE 'collars muted until: ' || COALESCE((xpath('/row/u/text()', query_to_xml(
                     'SELECT max(collars_muted_until) FILTER (WHERE collars_muted_until > now()) AS u FROM public.farm_settings',
                     false, true, '')))[1]::text, 'not muted') END

  UNION ALL
  SELECT 54, 'phones registered for push', 'INFO',
         CASE WHEN to_regclass('public.push_tokens') IS NULL THEN 'push_tokens missing'
              ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.push_tokens',
                                                        false, true, '')))[1]::text || ' phone(s)' END

  UNION ALL
  SELECT 55, 'telemetry arriving', 'INFO',
         count(*) || ' fixes in the last hour (by fix time)'
  FROM public.location_logs WHERE "timestamp" > now() - interval '1 hour'

  UNION ALL
  SELECT 56, 'open alerts', 'INFO',
         count(*) || ' unresolved (' || count(*) FILTER (WHERE alert_type = 'boundary_breach') || ' breach)'
  FROM public.alerts WHERE status = 'unresolved'

  UNION ALL
  -- An animal left in breach/warning by a collar that has since gone quiet
  -- keeps the app's siren going. README.md has an optional reset.
  SELECT 57, 'animal ' || l.name || ' is ' || l.animal_status::text || ' on old data', 'INFO',
         'newest fix: ' || COALESCE(to_char(f.last_fix, 'YYYY-MM-DD HH24:MI TZ'), 'none')
         || ' - clears on the next fix, or see README.md "Reset stale state"'
  FROM public.livestock l
  LEFT JOIN LATERAL (SELECT max(ll."timestamp") AS last_fix FROM public.location_logs ll
                     WHERE ll.collar_id = l.collar_id) f ON true
  WHERE l.animal_status IN ('breach', 'near_boundary')
    AND (f.last_fix IS NULL OR f.last_fix < now() - interval '10 minutes')

) report
ORDER BY ord, item;
