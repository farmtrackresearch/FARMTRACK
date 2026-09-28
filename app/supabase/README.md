# FarmTrack database (Supabase)

Everything the FarmTrack database needs is in this folder, as plain SQL you
paste into **Supabase → SQL Editor**. There is no migrations tool: every file
is written so it is safe to run again.

## What each file is

| File | What it does | Changes data? |
|---|---|---|
| `00_enum_values.sql` | Adds any missing enum values (such as `'LoRa'`). Must be committed before `schema.sql` can use them, so it is its own step. | No |
| `schema.sql` | The whole database: tables, fence trigger, gateway ingest, security rules, realtime, push, retention. One transaction; works on a new project and on the live one; keeps every existing row. | Structure only |
| `verify_setup.sql` | Read-only health check. One row per thing that must be true. | No |
| `tests/geofence_tests.sql` | Automated tests of the fence rules, the ingest and the security rules. Runs in a transaction that is rolled back, so nothing is kept. | No |
| `rekey_collar.sql` | One-off per collar: moves an existing collar to its new protocol-v2 ID, keeping its history. | Yes, that collar |
| `export_live_schema.sql` | Read-only export of the live database's structure (the result is saved as `live_schema_dump.json`, which is git-ignored). | No |

`gateway_ingest.sql` is gone: it never matched the live database, and
`schema.sql` now holds the real gateway ingest.

## Install or upgrade: run these in order

Do each step in a new SQL Editor tab: paste the whole file, press **Run**, and
check the result before going on.

**0. Keep a copy of what is there now.** Make sure `live_schema_dump.json`
(from `export_live_schema.sql`) is saved on your computer. It holds the
previous definition of every function and view. `schema.sql` does not delete
rows; if anything goes wrong it rolls back and changes nothing. On a paid plan,
also take a backup under **Database → Backups**.

1. **`00_enum_values.sql`** → `Success. No rows returned`.
2. **`schema.sql`** → `Success. No rows returned`.
   - If Supabase asks you to confirm a destructive operation, click **Run**
     (the file drops and recreates the map view and the security policies;
     it deletes no data).
   - If Supabase warns *"This query creates tables without enabling Row Level
     Security"*, click **Run without RLS**. `schema.sql` switches Row Level
     Security on for every table itself, and `verify_setup.sql` checks it.
   - It takes a few seconds and briefly locks the location table. A gateway
     uploading at that moment gets an error and retries; nothing is lost.
   - If it stops with an error, nothing was changed. Fix what the message
     says, then run it again. If the next query says *current transaction is
     aborted*, run `ROLLBACK;` once.
3. **`verify_setup.sql`** → every row says **OK** or **INFO**.
   Rows are named by the number in their `ord` column (for example "ord 37"),
   not by their position on the screen.
   - On a brand-new project, three rows say NONE until you have set things
     up: `registered gateways` (ord 50), `active geofences` (ord 51) and
     `collars paired to livestock` (ord 52). On the live project they say OK.
   - If `extension: pg_net` or `extension: pg_cron` says MISSING, go to
     **Database → Extensions**, switch that extension on, and run
     `schema.sql` again. (`schema.sql` tries to switch both on itself; the
     dashboard is the fallback.)
4. **`tests/geofence_tests.sql`** → one row starting **ALL TESTS PASSED**.
   Anything in brackets after it names a check this project could not run
   (for example the push check before `pg_net` is on). A failure names the
   rule that broke: `TEST FAILED: <what>`.
   - If Supabase warns *"This query creates tables without enabling Row Level
     Security"*, click **Run without RLS**. The only table the test creates is
     a temporary scratch table (`ft_ctx`) that exists only while the test
     runs and is wiped by the `ROLLBACK` at the end. Enabling RLS on it would
     make the test's own lookups fail when it acts as the app's roles.

Then, once:

5. **Turn off public sign-ups.** Go to **Authentication → Sign In / Providers**
   and switch off **Allow new users to sign up**. From then on you add people
   under **Authentication → Users → Add user**. Everyone starts as staff (see
   [Make someone an admin](#make-someone-an-admin)).
6. **Check the API guard** with the curl test in
   [PostGIS system tables](#postgis-system-tables-and-the-api-guard).
7. **If `verify_setup.sql` showed a row with ord 57 ("animal … is breach on
   old data")**, run [Reset stale state](#reset-stale-state-one-off).
   Otherwise skip this.

## Register or rotate a gateway

The gateway proves who it is with `GATEWAY_SECRET` from
`firmware/src/secrets.h`. The database stores only its SHA-256 hash, in
`public.gateways.api_key_hash`.

1. Make a long random secret on your computer:
   `openssl rand -hex 32`
2. Hash it on your computer, so the secret itself never goes into the
   dashboard (the SQL Editor keeps a history of what you run):
   `printf '%s' 'PASTE_THE_SECRET' | shasum -a 256`
   Copy the 64-character hex string, without the trailing ` -`.
3. In the SQL Editor, for a **new** gateway:
   ```sql
   INSERT INTO public.gateways (name, api_key_hash)
   VALUES ('Barn gateway', 'PASTE_THE_64_CHARACTER_HASH');
   ```
   To **rotate** the key of an existing gateway:
   ```sql
   UPDATE public.gateways SET api_key_hash = 'PASTE_THE_64_CHARACTER_HASH'
   WHERE name = 'Barn gateway';
   ```
4. Put the secret in `secrets.h` as `GATEWAY_SECRET` and flash the gateway.
   Its serial log shows `upload ok` once it is accepted; `upload failed,
   HTTP 403` means the hash does not match the secret.

The gateway uses the project's **anon** key (`SUPABASE_ANON_KEY`), never the
`service_role` key. The anon key can call `ingest_telemetry` and nothing else.

## Re-key a collar (after flashing protocol v2)

The v2 firmware gives each collar a new ID. At boot the collar prints both:

```
=== FarmTrack COLLAR  id=FT-AAAAAAAA ===                  <- new ID
(v1 firmware called this collar FT-BBBBBBBB - see ...)    <- old ID
```

Open `rekey_collar.sql`, put the old ID and the new ID into the two lines
marked `<<< SET THIS`, and run the whole file. If Supabase asks you to
confirm a destructive operation, click **Run** (it deletes the duplicate
collar row after moving its positions). It returns one row: the collar
under its new ID, its animal, and its number of positions and alerts. If the
gateway had already registered the new ID as a second collar, those positions
are merged in. Left unfilled, or run a second time, it stops with a message
and changes nothing.

A brand-new collar needs no SQL: the first time the gateway hears it, it
appears in the app's **Hardware** tab, unpaired, ready to pair to an animal.

## Make someone an admin

New accounts are always staff; nobody can promote themselves. In the SQL
Editor:

```sql
UPDATE public.profiles SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'person@example.com');
```

## How the fence state is decided

The trigger `detect_geofence_events` runs on every stored position. The app's
`evaluateAgainstFences()` (in `app/src/lib/utils.ts`) follows the same rules:

- **Breach:** outside every active fence, however far.
- **Warning** (`near_boundary`): inside a fence, within that fence's warning
  distance of its edge, judged on the fence the animal is deepest inside.
- **No active fences:** safe.
- **3 m hysteresis:** leaving breach needs 3 m inside; leaving warning needs
  3 m beyond the warning distance.
- `resting` is never replaced by `grazing`.
- A position older than the newest one already stored (a burst sent after a
  WiFi drop) is stored, but does not change the state.
- Alerts are written only when the state changes, and resolved automatically
  when the animal leaves that state. `audio_warning_count` counts entries into
  warning or breach.
- **Stationary:** an alert when the animal has moved less than 15 m in 60
  minutes; resolved once it moves.
- **Low battery:** an alert below 20 %, resolved at 30 % or more. Battery is
  unknown (empty) until a voltage divider is fitted to the collar.

What the gateway sends back to the collar is 0 (safe) whenever the farm is
muted (**Emergency Disable** in the app, at most 24 hours), when the newest
reading has no GPS fix, or when the newest stored fix is more than 60 seconds
old. Otherwise it is 2 for breach, 1 for warning, 0 for anything else.

## Push notifications

1. After sign-in, the app stores the phone's Expo push token in
   `public.push_tokens`. Each user sees only their own tokens. The function
   `register_push_token` also moves a token over when a phone changes user.
2. When an alert is inserted, the trigger `alerts_push_notify` sends one
   request to Expo's push service (`https://exp.host/--/api/v2/push/send`)
   through `pg_net`, for up to 100 phones:
   - breach → Android channel **alarms**
   - low battery and not moving → Android channel **alerts**
   - warnings are shown in the app only, not pushed
3. `pg_net` sends after the transaction commits. A push that fails is logged
   and never stops the position from being stored.

To see what was sent and what Expo answered:

```sql
SELECT id, status_code, content, created
FROM net._http_response ORDER BY created DESC LIMIT 20;
```

Push needs `pg_net` (see step 3 above) plus the app-side Firebase/APNs set-up
in `app/README.md`.

## Retention

Raw positions are kept for **30 days**. After that, `downsample_location_logs()`
keeps the first position of every minute for each collar and deletes the rest.
It runs every day at 19:17 UTC (03:17 in the Philippines) as the `pg_cron` job
`farmtrack-downsample-location-logs`. Alerts are never deleted.

To run it by hand: `SELECT public.downsample_location_logs();` (it returns
the number of rows it deleted).

## PostGIS system tables and the API guard

PostGIS lives in schema `public` on this project, and its table
`spatial_ref_sys` belongs to `supabase_admin`. Our `postgres` role can neither
remove the public key's write access to it nor switch on RLS for it. That is
why Supabase's Security Advisor warns about it. Deleting the SRID 4326 row from that
table through the REST API would break every fence check.

`schema.sql` closes that route with a PostgREST pre-request function,
`public.farmtrack_pre_request()`, set with
`ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.farmtrack_pre_request'`
(PostgREST's in-database configuration). It refuses, for the anon and
signed-in roles:

- `spatial_ref_sys`, `geometry_columns` and `geography_columns`;
- the GraphQL endpoint, which the app does not use and which exposes the same
  tables;
- any percent-encoded path (such as `spatial%5Fref%5Fsys`), because PostgREST
  decodes the name before looking the table up. The app never sends one.

The `verify_setup.sql` row with ord 37 (`API guard: pgrst.db_pre_request on
authenticator`) checks the setting. The Security Advisor warning
stays visible, because the table's own grants are unchanged.

**Confirm it from your computer** (replace the two placeholders; `srid=eq.-1`
matches no row, so this deletes nothing even if the guard were missing):

```sh
curl -i -X DELETE "https://YOUR-PROJECT.supabase.co/rest/v1/spatial_ref_sys?srid=eq.-1" \
  -H "apikey: YOUR-ANON-KEY" -H "Authorization: Bearer YOUR-ANON-KEY"
```

Then the same request with the table name percent-encoded, which must be
refused too:

```sh
curl -i -X DELETE "https://YOUR-PROJECT.supabase.co/rest/v1/spatial%5Fref%5Fsys?srid=eq.-1" \
  -H "apikey: YOUR-ANON-KEY" -H "Authorization: Bearer YOUR-ANON-KEY"
```

- **Pass (both):** `HTTP/2 401` or `403` with `"message":"forbidden"`.
- **Fail:** `HTTP/2 204` or `200`. The guard is not active. Look at the
  `verify_setup.sql` row with ord 37:
  - **OK:** restart the API under **Project Settings → General → Restart
    project**, then run the curl test again.
  - **Not OK:** run these two lines on their own in the SQL Editor and read
    the error they give:
    `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.farmtrack_pre_request';`
    `NOTIFY pgrst, 'reload config';`

Never drop `farmtrack_pre_request()` while the setting is in place: PostgREST
would then fail every request, including the gateway's. To remove the guard,
first run `ALTER ROLE authenticator RESET pgrst.db_pre_request;` and
`NOTIFY pgrst, 'reload config';`, then drop the function.

## Reset stale state (one-off)

Before v2, an animal could be left showing **breach** after its collar went
quiet, with old alerts still open. The app then sounds the siren every time
someone signs in. This clears it. The next GPS fix sets each animal's real
state again.

```sql
BEGIN;
UPDATE public.livestock SET animal_status = 'grazing'
WHERE animal_status IN ('breach', 'near_boundary');
UPDATE public.alerts SET status = 'resolved'
WHERE status = 'unresolved' AND alert_type IN ('boundary_breach', 'approach_warning');
UPDATE public.profiles SET farm_name = 'My Farm'
WHERE farm_name = 'Montana Ranch Operations';   -- the old placeholder name
COMMIT;
```

## Test the alarm without hardware

These add one made-up GPS fix for an animal's collar, exactly as if the gateway
had uploaded it, so the fence trigger, alerts, realtime, the app's siren and
push notifications all run for real. Replace `Bessie` and `Fence 1` with your
animal and fence names. Run each block on its own, a few seconds apart, with
the app open (or the phone locked, to test push).

**A. Put the animal back inside** (start here — an animal already in breach
does not change state, so nothing would fire):

```sql
INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", seq)
SELECT l.collar_id, ST_Y(ST_PointOnSurface(g.coordinates)), ST_X(ST_PointOnSurface(g.coordinates)), now(), 0
FROM public.livestock l, public.geofences g
WHERE l.name = 'Bessie' AND g.name = 'Fence 1';
```

Expect: the animal shows **grazing**, and old breach alerts close.

**B. Move it 40 m outside the fence:**

```sql
WITH target AS (
  SELECT l.collar_id, g.coordinates AS fence
  FROM public.livestock l, public.geofences g
  WHERE l.name = 'Bessie' AND g.name = 'Fence 1'
),
ring AS (
  SELECT t.collar_id, ST_Centroid(t.fence) AS ctr,
         (SELECT max(ST_Distance(ST_Centroid(t.fence)::geography, d.geom::geography))
            FROM ST_DumpPoints(t.fence) AS d) AS radius_m
  FROM target t
),
pt AS (
  SELECT collar_id, ST_Project(ctr::geography, radius_m + 40, 0)::geometry AS p FROM ring
)
INSERT INTO public.location_logs (collar_id, latitude, longitude, "timestamp", seq)
SELECT collar_id, ST_Y(p), ST_X(p), now(), 1 FROM pt;
```

Expect: the marker turns red, the siren sounds, one new **breach** alert
appears, and a locked phone gets a push notification.

**C. Run block A again.** Expect: the alarm stops and the breach alert resolves
itself.

These rows are ordinary GPS history. They do not affect the real collar: its
next genuine fix is newer and sets the animal's real state again. Checked in a
local Postgres + PostGIS copy of this database: A → grazing (old breach alerts
resolved), B → breach with exactly one new alert, A again → grazing with that
alert resolved.

## What changed in this version (for anyone reading the old SQL)

- **Gateway ingest (`ingest_telemetry`)** answers one element per collar,
  `{device_id, seq, state}`, where `seq` is that collar's newest reading in
  the batch. A wrong key gets HTTP 403 (it was 400). Unknown `FT-XXXXXXXX`
  collars are registered automatically. The live version answered
  `"unregistered"` and dropped the reading. Positions at (0,0) or out of range
  are not stored. A reading re-sent after a network error is stored once,
  including readings without GPS time. A v1 gateway still works.
- **`location_logs`** gains `sats` (satellites) and `received_at` (server
  receipt time); `"timestamp"` is the time of the fix. Rows from before v2
  have `received_at` copied from `"timestamp"`.
- **Security:** the public key can no longer read positions or fences. Users
  can change only their own name and farm name, and can only resolve alerts.
  Before v2 the live database gave signed-in users no UPDATE on alerts at all,
  so resolving from the app probably failed.
- **New:** `farm_settings` + `set_collars_muted` (Emergency Disable),
  `push_tokens` + `register_push_token` + the push trigger, retention, and the
  API guard.

## Undoing it

`schema.sql` changes structure, not rows. To go back, restore the previous
definitions from `live_schema_dump.json`: under `functions`, each `definition`
is a complete `CREATE OR REPLACE FUNCTION` statement; under `views`, the
`definition` is the `SELECT` to put after
`CREATE OR REPLACE VIEW public.latest_livestock_locations AS`. Or restore the
backup from step 0. Rolling back the gateway ingest also needs v1 firmware on the gateway
and collar.
