-- Apply once in Supabase SQL Editor, before updating the app. Safe to re-run.
-- Replaces only the position view; preserves its columns, grants and RLS behavior.
-- No telemetry, fence triggers, alerts, or animal records are modified.
BEGIN;

CREATE OR REPLACE VIEW public.latest_livestock_locations
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

COMMIT;
