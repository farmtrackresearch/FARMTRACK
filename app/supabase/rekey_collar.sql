-- =============================================================================
-- FarmTrack: give an existing collar its new protocol-v2 ID, keeping its
-- history, its animal and its alerts.
--
-- When: once per collar, after flashing the v2 firmware (runbook step 5).
-- The collar prints both IDs when it boots:
--
--   === FarmTrack COLLAR  id=FT-AAAAAAAA ===                     <- NEW ID
--   (v1 firmware called this collar FT-BBBBBBBB - see ...)       <- OLD ID
--
-- 1. Replace the two placeholders just below (keep the quotes).
-- 2. Supabase -> SQL Editor -> paste this whole file -> Run.
-- 3. Expect ONE row: the collar under its new ID, its animal, and how many
--    positions and alerts it has. Any problem stops with an error message
--    and changes nothing (it is one transaction).
--
-- What it does: the v2 gateway may already have registered the new ID as a
-- second, unpaired collar. That row's positions and alerts are moved onto
-- the old row, the extra row is deleted, and the old row is renamed to the
-- new ID. Running it again after it succeeded stops with "already done".
-- =============================================================================

SELECT set_config('farmtrack.rekey_old_id', 'FT-OLD_ID_HERE', false),   -- <<< SET THIS: old ID, from "(v1 firmware called this collar FT-...)"
       set_config('farmtrack.rekey_new_id', 'FT-NEW_ID_HERE', false);   -- <<< SET THIS: new ID, from "id=FT-..."

BEGIN;

DO $$
DECLARE
  v_old_id  text := upper(btrim(current_setting('farmtrack.rekey_old_id')));
  v_new_id  text := upper(btrim(current_setting('farmtrack.rekey_new_id')));
  v_old     record;
  v_new     record;
  v_old_animal uuid;
  v_new_animal uuid;
BEGIN
  IF v_old_id !~ '^FT-[0-9A-F]{8}$' OR v_new_id !~ '^FT-[0-9A-F]{8}$' THEN
    RAISE EXCEPTION 'Fill in both IDs at the top of this file first (each looks like FT- plus 8 characters 0-9/A-F). Got old=%, new=%', v_old_id, v_new_id;
  END IF;
  IF v_old_id = v_new_id THEN
    RAISE EXCEPTION 'The old and new IDs are the same (%). Nothing to do.', v_old_id;
  END IF;

  -- Lock both rows so the gateway's uploads wait until this is finished.
  SELECT * INTO v_old FROM public.collars WHERE device_hardware_id = v_old_id FOR UPDATE;
  SELECT * INTO v_new FROM public.collars WHERE device_hardware_id = v_new_id FOR UPDATE;

  IF v_old.id IS NULL THEN
    IF v_new.id IS NOT NULL THEN
      RAISE EXCEPTION 'Already done: there is no collar % any more, and % exists. Nothing changed.', v_old_id, v_new_id;
    END IF;
    RAISE EXCEPTION 'No collar % in the database. Check the old ID (run: SELECT device_hardware_id FROM public.collars;).', v_old_id;
  END IF;

  SELECT id INTO v_old_animal FROM public.livestock WHERE collar_id = v_old.id;

  IF v_new.id IS NOT NULL THEN
    SELECT id INTO v_new_animal FROM public.livestock WHERE collar_id = v_new.id;
    IF v_old_animal IS NOT NULL AND v_new_animal IS NOT NULL THEN
      RAISE EXCEPTION 'Both % and % are paired to an animal. Unpair one in the app (Hardware tab) and run this again.', v_old_id, v_new_id;
    END IF;

    -- Exact duplicates (same seq and time on both rows) are dropped first so
    -- the move cannot trip the de-duplication index.
    DELETE FROM public.location_logs n
    USING public.location_logs o
    WHERE n.collar_id = v_new.id AND o.collar_id = v_old.id
      AND n.seq IS NOT DISTINCT FROM o.seq AND n."timestamp" = o."timestamp";

    UPDATE public.location_logs SET collar_id = v_old.id WHERE collar_id = v_new.id;
    UPDATE public.alerts        SET collar_id = v_old.id WHERE collar_id = v_new.id;

    -- If the animal was paired to the new row in the meantime, move the pairing.
    IF v_new_animal IS NOT NULL THEN
      UPDATE public.livestock SET collar_id = NULL     WHERE id = v_new_animal;
      UPDATE public.livestock SET collar_id = v_old.id WHERE id = v_new_animal;
    END IF;

    -- Keep the newer health readings, which came in under the new ID.
    UPDATE public.collars
    SET last_ping_at    = GREATEST(COALESCE(v_old.last_ping_at, '-infinity'), COALESCE(v_new.last_ping_at, '-infinity')),
        battery_level   = v_new.battery_level,
        signal_strength = v_new.signal_strength,
        connection_type = v_new.connection_type,
        status          = v_new.status
    WHERE id = v_old.id;

    DELETE FROM public.collars WHERE id = v_new.id;
  END IF;

  UPDATE public.collars SET device_hardware_id = v_new_id WHERE id = v_old.id;
END
$$;

COMMIT;

-- Result: expect one row showing the new ID.
SELECT c.device_hardware_id AS collar,
       l.name               AS animal,
       (SELECT count(*) FROM public.location_logs ll WHERE ll.collar_id = c.id) AS positions,
       (SELECT count(*) FROM public.alerts a WHERE a.collar_id = c.id)         AS alerts,
       c.last_ping_at
FROM public.collars c
LEFT JOIN public.livestock l ON l.collar_id = c.id
WHERE c.device_hardware_id = upper(btrim(current_setting('farmtrack.rekey_new_id')));
