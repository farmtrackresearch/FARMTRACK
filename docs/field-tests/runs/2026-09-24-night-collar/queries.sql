-- =============================================================================
-- Night collar test - read-only checks against the LIVE FarmTrack database.
-- Paste one block at a time into the Supabase SQL editor, run it, and use
-- "Download CSV" to save each result into this run folder.
--
-- Every statement here is a SELECT. Nothing is written.
--
-- TIMEZONE: location_logs.timestamp is TIMESTAMPTZ and the SQL editor session
-- is usually UTC, so ALWAYS write the +08 offset explicitly as shown, or your
-- window will be off by eight hours and silently return the wrong rows.
--
-- Replace every 2026-09-25 HH:MM:SS+08 placeholder with the real times from
-- the data sheet (check the date - the session crosses midnight).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Q1. Did anything at all arrive tonight? Run this FIRST.
-- Expect one row per delivered fix. Zero rows means either the GPS never
-- locked (nothing is stored without fix=1) or no upload succeeded.
-- -----------------------------------------------------------------------------
SELECT ll.timestamp AT TIME ZONE 'Asia/Manila' AS local_time,
       ll.seq, ll.latitude, ll.longitude, ll.rssi, ll.snr
FROM public.location_logs ll
JOIN public.collars c ON c.id = ll.collar_id
WHERE c.device_hardware_id = 'FT-EC82C34C'
  AND ll.timestamp > NOW() - INTERVAL '3 hours'
ORDER BY ll.timestamp;


-- -----------------------------------------------------------------------------
-- Q2. End-to-end delivery over the Phase 3 clean window.
-- Compare rows_stored against the number of fix=1 RX lines the gateway log
-- shows for the same window. seq is a uint16 and is only ~405 tonight, so no
-- wrap can occur; a seq gap is a genuinely missing reading.
-- -----------------------------------------------------------------------------
SELECT COUNT(*)                                   AS rows_stored,
       MIN(ll.seq)                                AS seq_first,
       MAX(ll.seq)                                AS seq_last,
       MAX(ll.seq) - MIN(ll.seq) + 1              AS seq_span,
       MAX(ll.seq) - MIN(ll.seq) + 1 - COUNT(*)   AS rows_missing,
       ROUND(100.0 * COUNT(*)
             / NULLIF(MAX(ll.seq) - MIN(ll.seq) + 1, 0), 1) AS pct_stored
FROM public.location_logs ll
JOIN public.collars c ON c.id = ll.collar_id
WHERE c.device_hardware_id = 'FT-EC82C34C'
  AND ll.timestamp >= '2026-09-25 01:25:00+08'   -- clean window start
  AND ll.timestamp <  '2026-09-25 01:30:00+08';  -- clean window end


-- -----------------------------------------------------------------------------
-- Q3. Exactly which seq values are missing in that window.
-- Use this to tell "the radio dropped it" (no RX line in the gateway log)
-- from "the upload dropped it" (RX line present, no row here).
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT MIN(ll.seq) AS lo, MAX(ll.seq) AS hi
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  WHERE c.device_hardware_id = 'FT-EC82C34C'
    AND ll.timestamp >= '2026-09-25 01:25:00+08'
    AND ll.timestamp <  '2026-09-25 01:30:00+08'
)
SELECT g.seq AS missing_seq
FROM bounds b, generate_series(b.lo, b.hi) AS g(seq)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  WHERE c.device_hardware_id = 'FT-EC82C34C'
    AND ll.seq = g.seq
    AND ll.timestamp >= '2026-09-25 01:25:00+08'
    AND ll.timestamp <  '2026-09-25 01:30:00+08'
)
ORDER BY 1;


-- -----------------------------------------------------------------------------
-- Q4. GPS PRECISION - scatter of the static hold about ITS OWN MEAN.
-- This does NOT depend on the reference point, so it is the trustworthy
-- number tonight. Report it separately from accuracy.
-- Set the window to the Phase 1 static hold start/end.
-- -----------------------------------------------------------------------------
WITH pts AS (
  SELECT ll.latitude AS lat, ll.longitude AS lng
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  WHERE c.device_hardware_id = 'FT-EC82C34C'
    AND ll.timestamp >= '2026-09-25 00:45:00+08'   -- hold start
    AND ll.timestamp <  '2026-09-25 01:00:00+08'   -- hold end
),
mean_pt AS (SELECT AVG(lat) AS lat, AVG(lng) AS lng FROM pts),
d AS (
  SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
           ST_SetSRID(ST_MakePoint(m.lng, m.lat), 4326)::geography
         ) AS m
  FROM pts p CROSS JOIN mean_pt m
)
SELECT COUNT(*)                                                      AS n_fixes,
       ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY m)::numeric, 2) AS cep50_m,
       ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY m)::numeric, 2) AS p95_m,
       ROUND(AVG(m)::numeric, 2)                                     AS mean_m,
       ROUND(STDDEV_SAMP(m)::numeric, 2)                             AS sd_m,
       ROUND(MAX(m)::numeric, 2)                                     AS max_m
FROM d;


-- -----------------------------------------------------------------------------
-- Q5. GPS ACCURACY - error against the ground-truth reference point.
-- PASTE the reference lat/lng from the data sheet into the two literals below.
-- PROVISIONAL: the reference is a Google Maps satellite pin whose own absolute
-- error is a few metres, comparable to what is being measured. State that
-- limitation wherever this number is quoted.
-- -----------------------------------------------------------------------------
WITH ref AS (
  SELECT  9.364380::double precision AS lat,      -- <-- REPLACE
        123.271600::double precision AS lng       -- <-- REPLACE
),
pts AS (
  SELECT ll.latitude AS lat, ll.longitude AS lng
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  WHERE c.device_hardware_id = 'FT-EC82C34C'
    AND ll.timestamp >= '2026-09-25 00:45:00+08'   -- hold start
    AND ll.timestamp <  '2026-09-25 01:00:00+08'   -- hold end
),
d AS (
  SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
           ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326)::geography
         ) AS m,
         -- east-west and north-south components, to check whether the error is
         -- still almost entirely east-west as it was yesterday (11.84 m,
         -- consistent with multipath off the buildings)
         ST_Distance(
           ST_SetSRID(ST_MakePoint(p.lng, r.lat), 4326)::geography,
           ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326)::geography) AS ew_m,
         ST_Distance(
           ST_SetSRID(ST_MakePoint(r.lng, p.lat), 4326)::geography,
           ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326)::geography) AS ns_m
  FROM pts p CROSS JOIN ref r
)
SELECT COUNT(*)                                                      AS n_fixes,
       ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY m)::numeric, 2) AS cep50_m,
       ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY m)::numeric, 2) AS p95_m,
       ROUND(AVG(m)::numeric, 2)                                     AS mean_err_m,
       ROUND(MAX(m)::numeric, 2)                                     AS max_err_m,
       ROUND(AVG(ew_m)::numeric, 2)                                  AS mean_east_west_m,
       ROUND(AVG(ns_m)::numeric, 2)                                  AS mean_north_south_m
FROM d;


-- -----------------------------------------------------------------------------
-- Q6. Raw fixes for the static hold, for plotting / archiving as CSV.
-- -----------------------------------------------------------------------------
SELECT ll.timestamp AT TIME ZONE 'Asia/Manila' AS local_time,
       ll.seq, ll.latitude, ll.longitude, ll.rssi, ll.snr
FROM public.location_logs ll
JOIN public.collars c ON c.id = ll.collar_id
WHERE c.device_hardware_id = 'FT-EC82C34C'
  AND ll.timestamp >= '2026-09-25 00:45:00+08'
  AND ll.timestamp <  '2026-09-25 01:00:00+08'
ORDER BY ll.seq;


-- -----------------------------------------------------------------------------
-- Q7. Sanity: is the collar being seen at all, and is it still paired?
-- battery_level here is the HARDCODED 85 from collar.cpp - it is not a
-- measurement and must never be reported as one.
-- -----------------------------------------------------------------------------
SELECT c.device_hardware_id,
       c.last_ping_at AT TIME ZONE 'Asia/Manila' AS last_ping_local,
       c.status, c.connection_type,
       l.name AS animal, l.animal_status
FROM public.collars c
LEFT JOIN public.livestock l ON l.collar_id = c.id
WHERE c.device_hardware_id = 'FT-EC82C34C';


-- -----------------------------------------------------------------------------
-- Q8. Test alerts generated tonight, so they can be identified and excluded
-- later. Walking outside Fence 1 will have fired breach alerts - expected.
-- -----------------------------------------------------------------------------
SELECT a.created_at AT TIME ZONE 'Asia/Manila' AS local_time,
       a.alert_type, a.status, a.title
FROM public.alerts a
LEFT JOIN public.collars c ON c.id = a.collar_id
WHERE c.device_hardware_id = 'FT-EC82C34C'
  AND a.created_at > NOW() - INTERVAL '3 hours'
ORDER BY a.created_at;
