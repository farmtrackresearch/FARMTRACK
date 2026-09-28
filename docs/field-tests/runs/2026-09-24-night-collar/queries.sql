-- =============================================================================
-- Night collar test - read-only checks against the LIVE FarmTrack database.
-- Paste one block at a time into the Supabase SQL editor, run it, and use
-- "Download CSV" to save each result into this run folder.
--
-- Every statement here is a SELECT. Nothing is written.
--
-- >>> SET THIS FIRST: the collar ID <<<
-- Every query reads the collar from a `params` CTE at its top, and every
-- params CTE holds the same placeholder, FT-XXXXXXXX. Use the editor's Find
-- and Replace ("Replace all") ONCE for the whole file, replacing FT-XXXXXXXX
-- with the ID the collar prints at boot ("=== FarmTrack COLLAR  id=FT-... ===").
-- Q0 lists every collar the database knows, if you are unsure.
-- If the placeholder is left in, the query stops with an error saying
-- "... is not a collar ID", instead of silently returning zero rows.
--
-- The collar ID CHANGED with the protocol v2 firmware (it is now derived from
-- ESP.getEfuseMac() >> 16), so the pre-v2 ID FT-EC82C34C no longer matches the
-- collar. After the deployment runbook's re-key step, the collar's older rows,
-- including those from before the firmware change, sit under the NEW ID too.
--
-- SCHEMA: these queries need the v2 database (location_logs.received_at and
-- location_logs.sats). On an older database they fail with
-- "column ... does not exist".
--   received_at = when the server stored the row (receipt time).
--   timestamp   = when the GPS fix was taken, if the collar sent a valid GPS
--                 time; otherwise the gateway's radio receive time.
--   Rows stored BEFORE the v2 migration have received_at back-filled from
--   timestamp, and for those rows both columns are upload times, because the
--   v1 collar always sent gpsEpoch = 0.
--
-- TIMEZONE: received_at and timestamp are TIMESTAMPTZ and the SQL editor
-- session is usually UTC, so ALWAYS write the +08 offset explicitly as shown,
-- or your window will be off by eight hours and silently return the wrong rows.
--
-- Replace every 2026-09-25 HH:MM:SS+08 placeholder in the params CTEs with the
-- real times from the data sheet (check the date - the session crosses midnight).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Q0. Which collars exist, and when was each last heard? Run this if you are
-- not sure of the collar ID. Reflashing with v2 firmware makes the gateway
-- report a NEW ID, and the ingest may auto-create a collar row for it, so
-- expect to see both the old and the new ID until the runbook re-key is done.
-- -----------------------------------------------------------------------------
SELECT c.device_hardware_id,
       c.last_ping_at AT TIME ZONE 'Asia/Manila' AS last_ping_local,
       c.status, c.connection_type,
       l.name AS animal
FROM public.collars c
LEFT JOIN public.livestock l ON l.collar_id = c.id
ORDER BY c.last_ping_at DESC NULLS LAST;


-- -----------------------------------------------------------------------------
-- Q1. Did anything at all arrive tonight? Run this FIRST (after Q0 if needed).
-- Expect one row per stored reading. Zero rows means the GPS never locked
-- (check whether the ingest stores readings without a fix), no upload
-- succeeded, or the collar ID in params is not this collar's.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
)
SELECT ll.received_at AT TIME ZONE 'Asia/Manila' AS received_local,
       ll.timestamp   AT TIME ZONE 'Asia/Manila' AS fix_time_local,
       ll.seq, ll.latitude, ll.longitude, ll.sats, ll.rssi, ll.snr
FROM public.location_logs ll
JOIN public.collars c ON c.id = ll.collar_id
WHERE c.device_hardware_id = (SELECT collar_id FROM params)
  AND ll.received_at > NOW() - INTERVAL '3 hours'
ORDER BY ll.received_at, ll.timestamp, ll.seq;


-- -----------------------------------------------------------------------------
-- Q2. End-to-end delivery over the Phase 3 clean window (selected on
-- received_at, because the window is a receipt-time window).
-- Compare distinct_seq against the number of fix=1 RX lines the gateway log
-- shows for the same window.
--
-- Counting rules, and why:
-- * COUNT(DISTINCT seq), not COUNT(*): a reading stored twice must not raise
--   pct_stored. duplicate_rows shows how many extra rows there were.
-- * seq restarts at 0 whenever the collar reboots (the 2026-09-24 gateway log
--   shows four reboots in two hours). The rows are split into one segment
--   per boot at every point where seq goes down, and the span is counted per
--   segment. seq_restarts says how many splits there were. A uint16 wrap
--   (65535 -> 0) would also show up as a restart; that is harmless here.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id,
         '2026-09-25 01:25:00+08'::timestamptz AS win_start,   -- clean window start
         '2026-09-25 01:30:00+08'::timestamptz AS win_end      -- clean window end
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
),
w AS (
  SELECT ll.seq, ll.received_at, ll.timestamp,
         LAG(ll.seq) OVER (ORDER BY ll.received_at, ll.timestamp, ll.seq) AS prev_seq
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  CROSS JOIN params p
  WHERE c.device_hardware_id = p.collar_id
    AND ll.received_at >= p.win_start
    AND ll.received_at <  p.win_end
    AND ll.seq IS NOT NULL
),
seg AS (
  SELECT seq,
         COUNT(*) FILTER (WHERE seq < prev_seq)
           OVER (ORDER BY received_at, timestamp, seq) AS boot
  FROM w
),
per_boot AS (
  SELECT boot,
         COUNT(*)                AS rows_stored,
         COUNT(DISTINCT seq)     AS distinct_seq,
         MAX(seq) - MIN(seq) + 1 AS seq_span
  FROM seg
  GROUP BY boot
)
SELECT SUM(rows_stored)                   AS rows_stored,
       SUM(distinct_seq)                  AS distinct_seq,
       SUM(rows_stored - distinct_seq)    AS duplicate_rows,
       COUNT(*) FILTER (WHERE boot > 0)   AS seq_restarts,
       SUM(seq_span)                      AS seq_span,
       SUM(seq_span - distinct_seq)       AS rows_missing,
       ROUND(100.0 * SUM(distinct_seq) / NULLIF(SUM(seq_span), 0), 1) AS pct_stored
FROM per_boot;


-- -----------------------------------------------------------------------------
-- Q3. Exactly which seq values are missing in that window, per boot segment
-- (same segmentation as Q2).
-- Use this to tell "the radio dropped it" (no RX line in the gateway log)
-- from "the upload dropped it" (RX line present, no row here).
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id,
         '2026-09-25 01:25:00+08'::timestamptz AS win_start,   -- same as Q2
         '2026-09-25 01:30:00+08'::timestamptz AS win_end      -- same as Q2
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
),
w AS (
  SELECT ll.seq, ll.received_at, ll.timestamp,
         LAG(ll.seq) OVER (ORDER BY ll.received_at, ll.timestamp, ll.seq) AS prev_seq
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  CROSS JOIN params p
  WHERE c.device_hardware_id = p.collar_id
    AND ll.received_at >= p.win_start
    AND ll.received_at <  p.win_end
    AND ll.seq IS NOT NULL
),
seg AS (
  SELECT seq,
         COUNT(*) FILTER (WHERE seq < prev_seq)
           OVER (ORDER BY received_at, timestamp, seq) AS boot
  FROM w
),
per_boot AS (
  SELECT boot, MIN(seq) AS lo, MAX(seq) AS hi FROM seg GROUP BY boot
)
SELECT pb.boot AS boot_segment, g.seq AS missing_seq
FROM per_boot pb
CROSS JOIN LATERAL generate_series(pb.lo, pb.hi) AS g(seq)
WHERE NOT EXISTS (
  SELECT 1 FROM seg s WHERE s.boot = pb.boot AND s.seq = g.seq
)
ORDER BY pb.boot, g.seq;


-- -----------------------------------------------------------------------------
-- Q4. GPS PRECISION - scatter of the static hold about ITS OWN MEAN.
-- This does NOT depend on the reference point, so it is the trustworthy
-- number tonight. Report it separately from accuracy.
-- Set the window to the Phase 1 static hold start/end. Selected on timestamp
-- (the fix time), because the question is where the collar was when each fix
-- was taken. For rows stored before the v2 migration, timestamp is the upload
-- time, 1-3 s after the fix.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id,
         '2026-09-25 00:45:00+08'::timestamptz AS hold_start,
         '2026-09-25 01:00:00+08'::timestamptz AS hold_end
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
),
pts AS (
  SELECT ll.latitude AS lat, ll.longitude AS lng
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  CROSS JOIN params p
  WHERE c.device_hardware_id = p.collar_id
    AND ll.timestamp >= p.hold_start
    AND ll.timestamp <  p.hold_end
    AND ll.latitude IS NOT NULL AND ll.longitude IS NOT NULL
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
-- PROVISIONAL: the reference is a Google Maps satellite pin whose own absolute
-- error is a few metres, comparable to what is being measured. State that
-- limitation wherever this number is quoted.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id,
         '2026-09-25 00:45:00+08'::timestamptz AS hold_start,   -- same as Q4
         '2026-09-25 01:00:00+08'::timestamptz AS hold_end      -- same as Q4
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
),
ref AS (
  -- SET THIS: the reference point's latitude and longitude (6 dp) from this
  -- run's notes.md, section "Ground-truth reference point". Replace the text
  -- inside each pair of quotes with the number. There is deliberately no
  -- default: left as is, the query stops with
  -- "invalid input syntax for type double precision".
  SELECT 'REF_LAT_FROM_NOTES_MD'::double precision AS lat,   -- SET THIS
         'REF_LNG_FROM_NOTES_MD'::double precision AS lng    -- SET THIS
),
pts AS (
  SELECT ll.latitude AS lat, ll.longitude AS lng
  FROM public.location_logs ll
  JOIN public.collars c ON c.id = ll.collar_id
  CROSS JOIN params p
  WHERE c.device_hardware_id = p.collar_id
    AND ll.timestamp >= p.hold_start
    AND ll.timestamp <  p.hold_end
    AND ll.latitude IS NOT NULL AND ll.longitude IS NOT NULL
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
-- Same window and selection as Q4. Both clocks are exported.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id,
         '2026-09-25 00:45:00+08'::timestamptz AS hold_start,   -- same as Q4
         '2026-09-25 01:00:00+08'::timestamptz AS hold_end      -- same as Q4
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
)
SELECT ll.timestamp   AT TIME ZONE 'Asia/Manila' AS fix_time_local,
       ll.received_at AT TIME ZONE 'Asia/Manila' AS received_local,
       ll.seq, ll.latitude, ll.longitude, ll.sats, ll.rssi, ll.snr
FROM public.location_logs ll
JOIN public.collars c ON c.id = ll.collar_id
CROSS JOIN params p
WHERE c.device_hardware_id = p.collar_id
  AND ll.timestamp >= p.hold_start
  AND ll.timestamp <  p.hold_end
  AND ll.latitude IS NOT NULL AND ll.longitude IS NOT NULL
ORDER BY ll.timestamp, ll.seq;


-- -----------------------------------------------------------------------------
-- Q7. Sanity: is the collar being seen at all, and is it still paired?
-- battery_level is NOT a measurement and must never be reported as one: the
-- v1 collar hard-coded 85, and the v2 collar sends "unknown" (stored as NULL)
-- until a battery voltage divider is fitted.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
)
SELECT c.device_hardware_id,
       c.last_ping_at AT TIME ZONE 'Asia/Manila' AS last_ping_local,
       c.status, c.connection_type,
       l.name AS animal, l.animal_status
FROM public.collars c
LEFT JOIN public.livestock l ON l.collar_id = c.id
WHERE c.device_hardware_id = (SELECT collar_id FROM params);


-- -----------------------------------------------------------------------------
-- Q8. Test alerts generated tonight, so they can be identified and excluded
-- later. Walking outside Fence 1 will have fired breach alerts - expected.
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT CASE WHEN v ~ '^FT-[0-9A-F]{8}$' THEN v
              ELSE (v || ' is not a collar ID - see SET THIS at the top of queries.sql')::int::text
         END AS collar_id
  FROM (VALUES ('FT-XXXXXXXX'::text)) AS s(v)
)
SELECT a.created_at AT TIME ZONE 'Asia/Manila' AS local_time,
       a.alert_type, a.status, a.title
FROM public.alerts a
JOIN public.collars c ON c.id = a.collar_id
WHERE c.device_hardware_id = (SELECT collar_id FROM params)
  AND a.created_at > NOW() - INTERVAL '3 hours'
ORDER BY a.created_at;
