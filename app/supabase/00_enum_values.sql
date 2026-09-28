-- =============================================================================
-- FarmTrack: step 1 of 4 - enum values. Run this BEFORE schema.sql.
--
-- Supabase -> SQL Editor -> paste this whole file -> Run. Expected result:
-- "Success. No rows returned". Safe to run any number of times.
--
-- Why this is its own file: PostgreSQL will not let a transaction USE an enum
-- value that the same transaction added ("unsafe use of new value"). schema.sql
-- is one transaction and uses 'LoRa' (the collars.connection_type default and
-- the gateway ingest), so the value has to be committed first, here.
--
-- On a brand-new project the types do not exist yet; every block below then
-- does nothing, and schema.sql creates the types with all their values.
-- On an older database it appends any value the type is missing. It never
-- removes or renames a value.
-- =============================================================================

DO $$
DECLARE
  v_type   text;
  v_values text[];
  v_value  text;
BEGIN
  FOR v_type, v_values IN
    SELECT * FROM (VALUES
      ('user_role',       ARRAY['admin', 'staff']),
      ('collar_status',   ARRAY['active', 'offline']),
      ('health_status',   ARRAY['healthy', 'monitoring', 'critical']),
      ('alert_type',      ARRAY['approach_warning', 'boundary_breach', 'low_battery', 'stationary', 'info']),
      ('alert_status',    ARRAY['unresolved', 'resolved']),
      ('connection_type', ARRAY['LTE', 'Satellite', 'LoRa']),
      ('animal_status',   ARRAY['grazing', 'near_boundary', 'breach', 'resting'])
    ) AS t(type_name, type_values)
  LOOP
    IF to_regtype('public.' || v_type) IS NULL THEN
      CONTINUE;   -- fresh project: schema.sql creates it
    END IF;
    FOREACH v_value IN ARRAY v_values LOOP
      EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L', v_type, v_value);
    END LOOP;
  END LOOP;
END
$$;
