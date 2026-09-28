-- =============================================================================
-- FarmTrack: export the live database's structure (READ-ONLY).
--
-- Paste the whole file into Supabase -> SQL Editor -> Run. It returns ONE row
-- with ONE cell of JSON. Download the result as CSV and keep the file on your
-- own machine - it is git-ignored as app/supabase/live_schema_dump.*.
--
-- It reads catalog metadata and a few counts. It returns no GPS positions,
-- no keys and no key hashes, and it changes nothing.
--
-- Why it exists: parts of the live database (ingest_telemetry, the gateways
-- table, the averaged map view) were created by hand and never saved to this
-- repo. This export lets schema.sql be rebuilt to match the database exactly.
-- =============================================================================

WITH
tbls AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.reltuples
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid AND d.deptype = 'e')
),
vws AS (
  SELECT c.oid, c.relname, c.reloptions, c.relacl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('v', 'm')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid AND d.deptype = 'e')
),
fns AS (
  SELECT p.oid, p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass
                      AND d.objid = p.oid AND d.deptype = 'e')
)
SELECT jsonb_pretty(jsonb_build_object(
  'exported_at', now(),
  'postgres_version', version(),

  'extensions_installed', (
    SELECT jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname,
                                        'version', e.extversion) ORDER BY e.extname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace),

  'extensions_available', (
    SELECT jsonb_agg(jsonb_build_object('name', name, 'installed', installed_version)
                     ORDER BY name)
    FROM pg_available_extensions
    WHERE name IN ('pg_net', 'pg_cron', 'postgis', 'pgcrypto')),

  'enums', (
    SELECT jsonb_object_agg(t.typname,
             (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
              FROM pg_enum e WHERE e.enumtypid = t.oid))
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'),

  'tables', (
    SELECT jsonb_object_agg(t.relname, jsonb_build_object(
      'rls_enabled', t.relrowsecurity,
      'row_estimate', t.reltuples,
      'columns', (
        SELECT jsonb_agg(jsonb_build_object(
                 'name', a.attname,
                 'type', format_type(a.atttypid, a.atttypmod),
                 'not_null', a.attnotnull,
                 'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped),
      'constraints', (
        SELECT jsonb_agg(jsonb_build_object('name', co.conname,
                                            'def', pg_get_constraintdef(co.oid)))
        FROM pg_constraint co WHERE co.conrelid = t.oid),
      'indexes', (
        SELECT jsonb_agg(pg_get_indexdef(i.indexrelid))
        FROM pg_index i WHERE i.indrelid = t.oid),
      'triggers', (
        SELECT jsonb_agg(jsonb_build_object('name', tg.tgname,
                                            'enabled', tg.tgenabled::text,
                                            'def', pg_get_triggerdef(tg.oid)))
        FROM pg_trigger tg WHERE tg.tgrelid = t.oid AND NOT tg.tgisinternal),
      'policies', (
        SELECT jsonb_agg(jsonb_build_object('name', p.policyname, 'cmd', p.cmd,
                                            'roles', p.roles, 'using', p.qual,
                                            'with_check', p.with_check))
        FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.relname),
      'grants_to_client_roles', (
        SELECT jsonb_agg(DISTINCT g.grantee || ':' || g.privilege_type)
        FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = t.relname
          AND g.grantee IN ('anon', 'authenticated', 'PUBLIC'))
    ))
    FROM tbls t),

  'views', (
    SELECT jsonb_object_agg(v.relname, jsonb_build_object(
      'options', v.reloptions,
      'acl', v.relacl::text,
      'definition', pg_get_viewdef(v.oid, true)))
    FROM vws v),

  'functions', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', f.proname,
      'args', pg_get_function_identity_arguments(f.oid),
      'returns', pg_get_function_result(f.oid),
      'security_definer', p.prosecdef,
      'config', p.proconfig,
      'acl', p.proacl::text,
      'definition', pg_get_functiondef(f.oid)) ORDER BY f.proname)
    FROM fns f JOIN pg_proc p ON p.oid = f.oid),

  'auth_users_triggers', (
    SELECT jsonb_agg(jsonb_build_object('name', tg.tgname,
                                        'enabled', tg.tgenabled::text,
                                        'def', pg_get_triggerdef(tg.oid)))
    FROM pg_trigger tg
    WHERE tg.tgrelid = 'auth.users'::regclass AND NOT tg.tgisinternal),

  'realtime_publication', (
    SELECT jsonb_agg(schemaname || '.' || tablename ORDER BY tablename)
    FROM pg_publication_tables WHERE pubname = 'supabase_realtime'),

  'security_checks', jsonb_build_object(
    'authenticated_can_update_own_role',
      has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
    'signup_role_comes_from_metadata', (
      SELECT bool_or(pg_get_functiondef(f.oid) ILIKE '%raw_user_meta_data->>''role''%')
      FROM fns f WHERE f.proname = 'handle_new_user'),
    'anon_can_read_latest_livestock_locations',
      CASE WHEN to_regclass('public.latest_livestock_locations') IS NULL THEN NULL
           ELSE has_table_privilege('anon', 'public.latest_livestock_locations', 'SELECT') END,
    'anon_can_call_get_geofences_geojson',
      CASE WHEN to_regprocedure('public.get_geofences_geojson()') IS NULL THEN NULL
           ELSE has_function_privilege('anon', to_regprocedure('public.get_geofences_geojson()'), 'EXECUTE') END,
    'anon_can_call_ingest_telemetry',
      CASE WHEN to_regprocedure('public.ingest_telemetry(text,jsonb)') IS NULL THEN NULL
           ELSE has_function_privilege('anon', to_regprocedure('public.ingest_telemetry(text,jsonb)'), 'EXECUTE') END,
    'authenticated_can_rewrite_alert_type',
      has_column_privilege('authenticated', 'public.alerts', 'alert_type', 'UPDATE'),
    'spatial_ref_sys', (
      SELECT jsonb_build_object('schema', n.nspname,
                                'owner', pg_get_userbyid(c.relowner),
                                'rls_enabled', c.relrowsecurity,
                                'anon_can_write', has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE'))
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'spatial_ref_sys' LIMIT 1)
  ),

  'admin_accounts', (
    SELECT jsonb_agg(jsonb_build_object('email', u.email, 'full_name', p.full_name,
                                        'created_at', p.created_at))
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.role = 'admin'),

  'collars', (
    SELECT jsonb_agg(jsonb_build_object(
      'device_hardware_id', c.device_hardware_id,
      'created_at', c.created_at,
      'last_ping_at', c.last_ping_at,
      'status', c.status,
      'paired_to_animal', EXISTS (SELECT 1 FROM public.livestock l WHERE l.collar_id = c.id),
      'location_rows', (SELECT count(*) FROM public.location_logs ll WHERE ll.collar_id = c.id))
      ORDER BY c.created_at)
    FROM public.collars c),

  -- Every gateways column EXCEPT anything that looks like a key, hash or secret.
  'gateways', (
    SELECT jsonb_agg((SELECT jsonb_object_agg(k, v)
                      FROM jsonb_each(to_jsonb(g)) AS x(k, v)
                      WHERE k !~* '(key|hash|secret|token|password)'))
    FROM public.gateways g),

  'geofences', (
    SELECT jsonb_agg(jsonb_build_object('name', gf.name, 'is_active', gf.is_active,
                                        'warning_buffer_meters', gf.warning_buffer_meters))
    FROM public.geofences gf),

  'livestock', (
    SELECT jsonb_agg(jsonb_build_object('name', l.name, 'animal_status', l.animal_status,
                                        'has_collar', l.collar_id IS NOT NULL))
    FROM public.livestock l),

  'row_counts', jsonb_build_object(
    'location_logs', (SELECT count(*) FROM public.location_logs),
    'alerts_total', (SELECT count(*) FROM public.alerts),
    'alerts_unresolved', (SELECT count(*) FROM public.alerts WHERE status = 'unresolved'),
    'profiles', (SELECT count(*) FROM public.profiles))
)) AS live_schema;
