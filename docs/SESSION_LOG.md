# FarmTrack Session Log

Chronological record of development sessions, oldest first. Each entry keeps the
same set of sections; "None" means nothing happened in that category, "Not
recorded" means the information was never captured.

## 2026-09-24 03:43 HKT — Two-night hardware bring-up: GPS brownout root-caused (two causes), LoRa CRC enabled, SF7→SF9, end-to-end pipeline verified, field test Phase 1 unresolved

**Context:** Collar firmware, gateway firmware, Supabase backend, app, editor
tooling and docs. One continuous work session spanning two nights — "Night 1"
(2026-09-22 into 2026-09-23) and "Night 2" (2026-09-23 into 2026-09-24) — logged
as a single entry because only the closing clock time was recorded; the per-night
start and end times are Not recorded. Goal was to get the collar → LoRa → gateway
→ WiFi → Supabase → geofence → downlink path working on real hardware and then
field-test it.

**Changes made:**

Night 1 — tooling
- Built the PlatformIO project for the first time (`.pio` did not exist, so no
  toolchain or libdeps were on disk) and generated editor config with
  `pio project init --ide vscode`; copied `c_cpp_properties.json` to the repo
  root because cpptools only reads `.vscode/` from the workspace folder root,
  and the workspace root is the monorepo root while the PlatformIO project is in
  `firmware/`.
- Added the generated editor files (~64 KB of machine-local absolute paths,
  previously uncommitted but not ignored) to the root `.gitignore`.

Night 1 — backend
- Wrote `app/supabase/verify_setup.sql`, a read-only health check that derives
  everything from `information_schema` / `pg_catalog`.
- Wrote `app/supabase/gateway_ingest.sql`; it proved incompatible with the live
  database and now carries a prominent DO-NOT-RUN header (retained as design
  notes only).

Night 1 — firmware
- `collar.cpp`, `test_gps.cpp`: `pinMode(PIN_LED, INPUT)` and removed every
  `digitalWrite(PIN_LED, ...)` (GPIO2 contention workaround, commented as such).
- Added diagnostic sketches `src/test_gps_baud.cpp` (baud/protocol scanner) and
  `src/test_gps_power.cpp` (raw burst dump with inter-burst timing), with
  matching `platformio.ini` environments `gps_baud` and `gps_power`.
- Satellite count encoded into `UplinkPacket.flags` bits 1–5 so the gateway can
  print it; packet size unchanged, so no protocol version bump.

Night 1 — app
- `app/src/app/(tabs)/map.tsx`: camera now frames collar positions plus fence
  corners instead of centring on the phone; removed the leftover demo-scaffolding
  ref that blocked the collar/fence fit from ever running. Added a 6 m movement
  deadband (`STABLE_THRESHOLD_M = 6`) so a stationary animal's marker holds still
  — display only; `detect_geofence_events` still evaluates every raw reading.
- Replaced `latest_livestock_locations` with a version averaging the last 5 fixes.
- Resized Fence 1 from 52 m² (~7.2 m across, smaller than the GPS error) to a
  ~60 m box.
- `app/src/types/database.ts`: `LocationLog` gained `seq` / `rssi` / `snr` /
  `gateway_id`.

Night 2 — firmware and config
- `LoRa.enableCrc()` on both collar and gateway.
- Spreading factor raised 7 → 9 on both boards (`LoRa.setSpreadingFactor(9)`).
- `gateway.cpp`: same GPIO2 fix as Night 1 (`pinMode(PIN_LED, INPUT)`, removed
  the three `digitalWrite(PIN_LED, ...)` calls per packet).
- Hardware: moved the GPS VCC wire from the ESP32 3V3 pin to VIN.
- Fence 1 `warning_buffer_meters` changed 30 → 15.
- `collar.cpp` `SEND_INTERVAL_MS` temporarily raised 3000 → 30000 as a
  diagnostic, commented to be reverted.

Night 2 — docs (field-test-planner agent)
- `docs/field-tests/plans/night-collar-gps-lora-e2e.md`,
  `docs/field-tests/plans/night-collar-DATASHEET.md`,
  `docs/field-tests/runs/2026-09-24-night-collar/` (notes.md, points.csv,
  queries.sql), `docs/field-tests/scripts/analyze_gateway_log.py`,
  `docs/field-tests/SUMMARY.md`.

**Errors encountered:**
- VS Code: "#include errors detected, update includePath" on firmware files.
- NEO-6M emitted ~17 bytes of its boot banner then restarted, roughly 12 times a
  second, indefinitely. TinyGPSPlus showed `rxBytes` climbing with `sentencesOk`
  stuck at 0 and `csumErr` 0.
- Two drafts of `verify_setup.sql` failed against the live schema (assumed
  columns that do not exist, e.g. `gateways.is_active`).
- App displayed no data at all.
- Gateway printed packets from device IDs that do not exist: `EC82CA4C` and
  `E682C2EA` alongside the real `EC82C34C`, one reporting a plausible-looking
  `fix=1 sats=10`.
- Gateway serial: "Brownout detector was triggered", `rst:0xc` — the ESP32's own
  brownout detector reset the board.
- Gateway HTTPS upload failures: `-1` (connection), `-11` (read timeout),
  `-29312` (SSL EOF), starting around 17–20 minutes of uptime and growing more
  frequent.
- After the GPIO2 fix, GPS ran cleanly for ~3.7 minutes (`sentencesOk` at 6/sec)
  then `sentencesOk` froze while `rxBytes` kept climbing; an anomalous sentence
  rate of 21/sec was also seen.
- Field test Phase 1: outdoors the collar reached `sats=3`, then `sats=4` with
  intermittent drops to 0, then `sats=0` held through 23 minutes; `fix=1` never
  achieved.

**Bugs found:**
- GPS brownout, cause 1 of 2 — GPIO2 pin contention. The SX1278's DIO0 is
  physically wired to GPIO2, which is also `PIN_LED`. Firmware drove GPIO2 as an
  output while the radio drove it too: two push-pull outputs shorted together,
  collapsing the 3V3 rail the GPS shares. This is a wiring deviation from
  `pins.h`, which declares `PIN_LORA_DIO0 = 26`. LoRa still worked because the
  library polls `parsePacket()` rather than using the DIO0 interrupt.
- GPS brownout, cause 2 of 2 — GPS VCC connected to the ESP32 3V3 pin instead of
  VIN/5V as `pins.h` line 10 specifies. On 3V3 the module's onboard regulator
  sits in dropout with no headroom, on a rail shared with the ESP32 and SX1278.
  `test_gps_power`'s raw dump identified it: every burst began with
  `$GPTXT,01,01,02,u-blox ag - www.u-blox.com*50` with gaps of 491–1014 ms — the
  module was completing its full power-on banner and restarting one to two times
  per second, which also explains the 21/sec sentence rate (~11 valid sentences
  per boot at ~2 boots/sec).
- LoRa payload CRC was disabled. The sandeepmistry LoRa library leaves it OFF by
  default and `gateway.cpp` validates only packet size and protocol version, so
  bit-flipped packets passed both checks and were logged as genuine telemetry —
  including the flags byte carrying fix and satellite count. `EC82CA4C` is the
  real ID with 2 bit errors, `E682C2EA` with 7.
- GPIO2 contention was also present in `gateway.cpp` — Night 1's fix was applied
  to `collar.cpp` and `test_gps.cpp` but `gateway.cpp` was missed.
- "Collar stops sending after ~20 minutes" was not a collar fault: at RSSI −97
  with SNR −10 the link was below the SF7 demodulation floor. The collar never
  stopped transmitting; the gateway could not hear it. The "20 minutes" was
  coincidence. Firmware was ruled out by test (21 minutes on USB, seq past 420,
  no stop) and so was the USB power bank (20 minutes on battery, seq 127 → 405
  continuous, no reset); `seqCounter` is uint16 at 3 s so it wraps at 54 hours
  and `millis()` overflow is 49 days — both arithmetically excluded. One false
  alarm: a monitor appeared to stop mid-run, but VS Code had restarted the
  terminal ("History restored" in the scrollback) and seq had continued 127 → 405.
- Gateway HTTPS degradation with uptime: `uploadReading()` constructs a fresh
  `WiFiClientSecure` and a full TLS handshake per reading, every 3 seconds, with
  no timeout configured on either `WiFiClientSecure` or `HTTPClient`. Consistent
  with heap fragmentation, since each handshake needs tens of KB contiguous.
- Gateway ESP32 brownout: its 3.3 V rail sagged below ~2.6 V. Suspected cause is
  SF9 tripling LoRa transmit duration and overlapping more often with WiFi
  current bursts on a marginal USB supply — suspected, not confirmed.
- Fence 1's `warning_buffer_meters` was 30 on a ~60 m fence, so every interior
  point was inside the buffer and "grazing"/safe was physically unreachable.
- Fence 1 was originally 52 m² (~7.2 m across) — smaller than the measured GPS
  error.
- App showed nothing because it was in demo mode: the login screen's Admin/Staff
  buttons call `signInDemo()`, which sets `demoMode` true, and `useFarmData` then
  never queries Supabase — it loads `DEMO_LOCATIONS` and `DEMO_GEOFENCES`, both
  empty arrays.
- `app/supabase/schema.sql` does not describe the live database. The deployed DB
  already had `public.gateways`, `ingest_telemetry()`, `seq`/`rssi`/`snr`/
  `gateway_id` columns on `location_logs`, and `'LoRa'` added to the
  `connection_type` enum — none of which are in the repo file. The deployed
  `ingest_telemetry` authenticates against an unsalted hex SHA-256 column named
  `api_key_hash`; `gateway_ingest.sql` assumed `key_hash`/bcrypt and
  `RETURNS TABLE` where the live function `RETURNS jsonb`.

**Fixes applied:**
- Editor config: built the project, generated and copied `c_cpp_properties.json`
  to the repo root, added the generated files to the root `.gitignore`. Verified
  by the include errors clearing.
- GPIO2 contention: `pinMode(PIN_LED, INPUT)` and all `digitalWrite(PIN_LED, ...)`
  removed in `collar.cpp`, `test_gps.cpp` (Night 1) and `gateway.cpp` (Night 2).
  Verified: `sentencesOk` went from stuck-at-0 to climbing 6/sec with `csumErr` 0.
  This is a software workaround; the proper fix is moving the DIO0 jumper to
  GPIO26, which was not done.
- GPS VCC moved from 3V3 to VIN (one wire). Verified over 5 continuous minutes:
  bursts at a steady 993–1002 ms, 162 bytes each, every one beginning with
  `$GPRMC`, and the `$GPTXT` banner appearing only once at startup.
- `LoRa.enableCrc()` on both boards. Any marginal-RSSI reading taken before this
  is untrustworthy.
- Spreading factor 7 → 9 on both boards. Rationale from the link data: RSSI −96
  with SNR −10 implies a site noise floor of −86 dBm, ~35 dB above thermal for a
  125 kHz channel (433 MHz ISM is shared with car remotes and gate openers). SF9
  lowers the demodulator SNR limit from −7.5 dB to −12.6 dB (~5 dB, roughly 1.8×
  range) at 185 ms airtime vs 57 ms — 6% duty cycle on a 3-second interval. SF12
  was rejected: 1483 ms airtime is a 49% duty cycle at that interval. Verified on
  the bench (SNR rose from ~9.5 to ~13.5 at the same RSSI) and in the field (link
  held at RSSI −80 to −88 with positive SNR where SF7 had been failing at −90).
  Both boards must match or neither hears the other.
- Fence 1 resized to a ~60 m box and `warning_buffer_meters` set to 15. Note: 15 m
  is only just above the measured ~12 m GPS error, so the warning transition will
  be noisy; the honest fix is a larger paddock.
- App demo-mode blank screen resolved by signing in with a real Supabase account
  (no code change).
- Gateway secret verified against the live RPC by calling `ingest_telemetry` with
  `p_readings:[]`, which authenticates without logging anything.
- App changes: `tsc --noEmit` clean after every one.
- Gateway TLS heap degradation: NOT FIXED. Pressing EN clears it; the real fix is
  batching (`ingest_telemetry` already accepts an array) or connection reuse.

Verified results (end-to-end, not tied to a single fix):
- Night 1: full pipeline verified end to end — collar → LoRa → gateway → WiFi →
  Supabase → PostGIS geofence evaluation → downlink → buzzer, about 3 seconds
  from a database UPDATE to the collar changing state. GPS reached 7–8 satellites
  and logged a real track.
- GPS accuracy against a Google Maps imagery reference: 11.84 m total error,
  +1.05 m north-south and −11.80 m east-west. The near-pure east-west bias
  indicates multipath off the adjacent buildings, not random noise.
- Field test Phase 0 completed: gateway monitor restarted with `-f time
  -f log2file`; gateway reset at 00:53:02; WiFi 192.168.0.106; first RX seq=790
  at 00:53:13; measured end-to-end RX→TX reply latency 2.06 s; phone-to-laptop
  clock offset +1 s (negligible); reference point established at
  9.364401593684349, 123.27160536641064 (north-west corner of the concrete fence
  post by the gate), computed to be 28.6 m from the nearest Fence 1 edge and
  inside the safe core.
- Field test Phase 1: UNRESOLVED (see Errors).

**Open items:**
- Nothing is committed. The firmware that runs this system has never been in
  version control: `firmware/src/collar.cpp`, `firmware/src/gateway.cpp` and
  `firmware/src/packet.h` are still untracked, and every change above is
  uncommitted working-tree state. Last commit is 3a51f8e (2026-09-03).
- GPS does not hold a fix outdoors. Current hypothesis under test: the collar's
  own LoRa transmissions disturb the GPS — the 5-minute stability proof was
  obtained with the radio asleep (`test_gps_power` never transmits), whereas
  `collar.cpp` transmits every 3 s holding ~120 mA for 185 ms at SF9, the same
  class of current spike that tripped the gateway's brownout detector. Diagnostic
  in flight: `SEND_INTERVAL_MS` raised to 30000. If `sats` climbs and holds at
  30 s but collapses at 3 s, the transmit is the cause.
- `collar.cpp` `SEND_INTERVAL_MS` must be reverted to 3000.
- Gateway TLS heap degradation unfixed (batching or connection reuse).
- Gateway brownout cause is suspected only, not confirmed.
- Multi-fence breach logic is wrong: `detect_geofence_events` flags a breach when
  outside ANY active fence, while `packet.h` defines breach as outside EVERY
  fence. The two agree only with exactly one active fence.
- `app/supabase/schema.sql` still does not describe the live database.
- `UplinkPacket.battery` is hardcoded to 85; there is no fuel gauge, so
  `collars.battery_level` is not a measurement and the low_battery alert is
  untestable.
- `gpsEpoch` is always 0, so `location_logs.timestamp` is the server's upload
  time, 1–3 s late.
- DIO0 is physically on GPIO2 rather than GPIO26; worked around in software in
  all three sketches, never rewired.
- `app/supabase/gateway_ingest.sql` is incompatible with the live DB and is
  retained only as design notes.
- Cross-check note: the working tree also carries uncommitted changes not
  mentioned in this session's summary — `app/eas.json` (staged as added),
  `app/app.json`, `app/package.json`, `app/package-lock.json`, `app/README.md`,
  `app/src/components/map/RanchMap.native.tsx`,
  `app/src/components/map/RanchMap.types.ts`,
  `app/src/components/map/FenceDrawingPanel.tsx`, `app/src/hooks/useAlarm.tsx`,
  `firmware/.vscode/extensions.json`, deletion of `firmware/TEST CODES /gps.cpp`,
  and additions of `firmware/src/secrets.h.example` and `firmware/logs/`. Several
  have file timestamps predating this session. Which session produced them is
  Not recorded.

## 2026-09-27 HKT — v2.5 full review fixes: protocol v2, gateway rebuilt, server-authoritative fence state, database rebuilt from live export, push notifications

**Context:** Collar firmware, gateway firmware, Supabase, app, field-test tooling
and docs. The work ran from 2026-09-25 to 2026-09-27 HKT. Exact start and end
times are Not recorded; this entry was written at 2026-09-27 13:10 HKT.

A four-agent read-only review of the whole project (code-reviewer,
gps-collar-firmware, supabase-data, mobile-app-reviewer) found about 70 issues.
The user asked for all of them to be fixed, critical down to low, and documented.
The approved plan (`~/.claude/plans/starting-to-the-critical-wild-sutton.md`)
defined a shared "contract v2" for collar, gateway, database and app, with the
server as the single source of truth for fence state.

The work was split by folder:
- gps-collar-firmware: `firmware/`
- mobile-app-reviewer: `app/`
- supabase-data: `app/supabase/`
- field-test-planner: `docs/field-tests/`

code-reviewer then cross-checked the work in 3 passes (whole system; firmware +
app; database), and reliability-engineer reviewed the firmware. Every finding
they raised was fixed.

Final tally: 86 tracked findings (9 critical, 21 high, 30 medium, 26 low). Of
these, 74 are fixed in code, 5 need user action, 3 are hardware and 4 are
accepted limitations.

Baseline was commit 78b8485 (2026-09-24 04:31 HKT). Nothing from this session is
committed. It all sits on branch `FARMTRACK-v2.5/setup-guide-and-agents`: 60
tracked files modified, 19 deleted and 13 new, with +13,443 / −5,255 lines in
tracked files.

**Changes made:**

Contract v2 (shared by all layers)
- `PROTO_VERSION 2`. The uplink stays 21 bytes. The downlink is now 8 bytes,
  `{version, deviceId, seq, state}`, and echoes the uplink's `seq`. Both sizes
  are enforced with `static_assert`. Collar and gateway must be flashed together.
- Field meanings:
  - `gpsEpoch` is real Unix seconds, or 0 when unknown.
  - `battery` is 0–100, or 255 for unknown.
  - Flag bit 0 is the fix: at least 4 satellites, HDOP ≤ 5 and age under 5 s.
  - Bits 1–5 are satellites *used*, bit 6 is `gps_ok` and bit 7 is `gps_rst`.
- Fence rules, identical in the database trigger and the app evaluator:
  - Breach means outside every active fence, at any distance.
  - Warning means inside the buffer of the fence the point is deepest inside.
  - No active fences means safe.
  - 3 m hysteresis applies.
  - `resting` is never overwritten by grazing.
- The server returns SAFE when the farm is muted, the newest reading has no fix,
  or the newest stored fix is more than 60 s old.
- Gateway serial log prefixes are frozen. New fields are appended only.

Collar firmware (`firmware/src/collar.cpp`)
- A reply is applied only when:
  - its version, deviceId and `seq` match this uplink, and
  - this uplink had a usable fix.
- After 3 cycles with no fix-backed reply, the collar goes silent.
- New ID is `ESP.getEfuseMac() >> 16`. The boot log also prints the v1 ID so the
  collar can be re-keyed.
- 30 s task watchdog.
- Restart after a radio-init failure.
- The radio is re-initialised after 5 missed replies or a TX timeout.
- Reset reason printed at boot (new `reset_reason.h`).
- GPS:
  - 1024-byte UART buffer.
  - The GPS is read during the reply wait, TX airtime and beeps.
  - Fix gate.
  - Real `gpsEpoch`.
  - Diagnostic bits 6 and 7.
- The beep level escalates immediately and de-escalates only after 2 lower
  replies.
- `SEND_INTERVAL_MS` is back to 3000, with ±10% jitter.
- Compile-time flags `BATTERY_SENSE_ENABLED` (GPIO35) and `GPS_POWER_SAVE`, both
  default 0.
- IQ-inverted listening for replies.

Gateway firmware (`firmware/src/gateway.cpp`), rebuilt as two FreeRTOS tasks
- Radio loop (core 1):
  - The only code that touches LoRa, and it never stops listening.
  - Queues uplinks; the queue holds 256 and drops the oldest when full.
- Upload task (core 0, 12,288-byte stack):
  - Batches up to 64 readings, oldest first, over one persistent TLS connection.
  - Timeouts: 5 s handshake, 3000 ms HTTP connect and read, and a 3 s deadline
    for the whole response body (read into a fixed 4 KB buffer).
- Certificate verification against 6 bundled roots (new `supabase_ca.h`).
  `GATEWAY_TLS_INSECURE` is an opt-in debug flag.
- Error handling:
  - A 5xx, 408, 429 or final −11 keeps the batch and backs off 1–8 s. After 3 in
    a row the batch is halved; a single reading that fails 3 more times is
    dropped.
  - Other 4xx codes drop the batch.
  - 5 transport failures with WiFi up cause a restart, but only after the server
    has been reached since boot, or after 15 min of uptime.
- 60 s watchdog covering both tasks.
- `setAutoReconnect` plus a full reconnect after 60 s down.
- `WiFi.setSleep(false)`.
- Radio self-heal after a failed reply TX, or after 5 min without an uplink.
- Upload-task creation is checked.
- Replies go out IQ-inverted, one per device, only if under 3500 ms old.
- Uploads send null lat/lng without a fix and null battery for 255, and forward
  `sats`, `gps_ok`, `gps_restarted` and `age_ms`.
- Response parsing is strict.
- New log lines, including `upload ok n= ms= heap= maxblk=`, `reset reason:` and
  `TX reply ... seq= dev=`.

Shared firmware and test sketches
- New `lora_link.h`:
  - `loraBeginLink()` sets SF9, 125 kHz, CRC on and sync word 0xF3.
  - `loraSend()` has a 1 s TX deadline.
- `pins.h`: link constants, `PIN_BATTERY_ADC 35`, and corrected comments.
- All test sketches leave GPIO2 as an input. lora_tx and lora_rx use the real
  link profile.
- `platformio.ini` pins espressif32 7.1.0, TinyGPSPlus 1.1.0, LoRa 0.8.0 and
  ArduinoJson 7.4.3.
- `firmware/README.md` rewritten.

Database (`app/supabase/`)
- Step 0: the user ran the new read-only `export_live_schema.sql`. Its output is
  saved as `live_schema_dump.json`, which is git-ignored. It was exported
  2026-09-26 13:15 UTC from PostgreSQL 17.6, with PostGIS 3.3.7 in `public`.
- `schema.sql` was rebuilt from that export as one idempotent `BEGIN … COMMIT`
  of 1,540 lines, for both the live database and a new project.
- New `00_enum_values.sql` adds `'LoRa'`. `schema.sql` refuses to run without it.
- `ingest_telemetry` v2:
  - Each reading has its own sub-transaction; readings are processed in order
    with `WITH ORDINALITY`.
  - The response is `[{device_id, seq, state}]`, one element per device.
  - Unknown `FT-` IDs are auto-registered.
  - Battery NULL means unknown.
  - (0,0) positions are rejected.
  - `sats` and `received_at` are stored.
  - De-duplication covers ts=0 retries within 120 s, with 10 s fix-time slack.
- `detect_geofence_events` rewritten to the contract:
  - The status is written only when it changes.
  - Alerts are raised on transitions only, and resolve automatically.
  - Adds `audio_warning_count` and a stationary alert.
- `upsert_geofence`: a NULL parameter keeps the existing value, and the polygon
  is checked with `ST_IsValid`.
- New tables and functions:
  - `farm_settings` and `set_collars_muted`, a working Emergency Disable.
  - `push_tokens`, `register_push_token` and `notify_alert_push` (pg_net → Expo
    push).
  - `downsample_location_logs` on a daily pg_cron job: raw rows for 30 days,
    then 1 per collar per minute.
  - `farmtrack_pre_request`, a PostgREST guard.
- Grants:
  - Column-level UPDATE on `profiles` and `alerts`.
  - The view is `security_invoker`.
  - `get_geofences_geojson` is SECURITY INVOKER.
  - anon holds no table privileges.
  - search_path is pinned on every function.
- Constraints and indexes:
  - Latitude and longitude range CHECKs.
  - `battery_level` is nullable.
  - The location_logs → collars FK is now RESTRICT.
  - New index `alerts(livestock_id, alert_type, status)`.
  - The view uses a `LEFT JOIN LATERAL` over the last 5 fixes.
  - `geofences` and `farm_settings` added to realtime.
- New `rekey_collar.sql`, `tests/geofence_tests.sql` and `README.md`. The README
  includes "Test the alarm without hardware".
- `verify_setup.sql` rewritten. `gateway_ingest.sql` deleted.

App (`app/`)
- Server-authoritative status: client-side fence evaluation and the fabricated
  alerts are removed. The siren fires on a realtime `boundary_breach` INSERT, and
  at load for animals already in breach. It is dismissed when the server status
  leaves breach.
- Realtime:
  - The effect is keyed on profile id only.
  - Channel names are unique, with one channel per table.
  - A status callback reloads on reconnect.
  - AppState auto-refresh.
  - A session-expired guard.
- Auth:
  - The listener callback never awaits.
  - The profile is fetched only when the user changes, and is cached.
  - Sign-out is local to this phone.
- Push: `pushNotifications.ts` and `usePushRegistration.ts`, using the
  `register_push_token` RPC; `app.config.ts` supplies `google-services.json`.
- Every write handles errors. The alerts query is limited, and the context value
  is memoised.
- UI:
  - Opt-in phone-position check.
  - Honest online/offline/stale indicators.
  - Emergency Disable.
  - Multi-alarm `useAlarm` with the overlay at the root layout.
  - A Resolve button.
  - Fence buffer and active settings.
  - Edit animal and pair collars.
  - Analytics from real data.
  - Animals drawn as one MapLibre layer.
  - MapTiler satellite imagery.
  - Demo links only when Supabase is unconfigured, plus a demo banner.
- Config:
  - `app.json` permissions cleaned up; background location and audio removed
    and blocked.
  - `eas.json` gets an environment per profile.
  - ESLint set up.
  - Unused packages, template assets and `scripts/reset-project.js` removed.
  - `app/.gitignore` adds `supabase/live_schema_dump.*` and
    `google-services.json`.

Field-test tooling (`docs/field-tests/`)
- `analyze_gateway_log.py`:
  - Handles windows that cross midnight.
  - Splits PDR into segments at collar reboots and seq wraps.
  - Reads the v2 fields and new event lines.
  - Pairs replies to uplinks on (dev, seq).
  - New `--selftest`.
- `queries.sql`:
  - `COUNT(DISTINCT seq)` and boot segments.
  - A validated collar-ID parameter and a new Q0.
  - A reference-point placeholder with no default.
  - Selection on `received_at`.
- Plan, datasheet and `SUMMARY.md` gained blocks for recording the protocol v2
  build. No new measurements were added.

Docs
- Updated the root `README.md`, `firmware/README.md` and `app/README.md`, and
  added `app/supabase/README.md`.
- `.claude/agents/{code-reviewer,debugger,supabase-data}.md` no longer reference
  `gateway_ingest.sql`.
- The full report is published as a private claude.ai artifact, "FarmTrack Fix
  Report".

**Errors encountered:**
- Agent tooling:
  - Several agents were cut off by API session limits (HTTP 429).
  - One was cut off by HTTP 403 "organization has disabled Claude subscription
    access".
  - The Claude Code process restarted once.
  - Each agent was resumed from its saved transcript. The session summary
    reports no lost work; git cannot confirm this.
- The first firmware build failed because `isTransmitting()`,
  `getSpreadingFactor()` and `getSignalBandwidth()` are private in LoRa 0.8.0.
- `npx expo-doctor` first flagged 7 patch-level version mismatches.
- First database mutation run: 3 of 28 injected bugs were not caught, because a
  second security layer still blocked anon.
- The reliability review of the new gateway and collar code found a boot loop and
  a stale radio flag (see Bugs found).
- The final database review found a way to bypass the new API guard with a
  percent-encoded path (see Bugs found).

**Bugs found:**

Critical
1. The app showed an animal outside every fence, but beyond the warning buffer,
   as "grazing". That resolved its breach and silenced the siren.
   - Root cause: `evaluateAgainstFences` returned breach only within the buffer.
   - The app also re-evaluated fences client-side and created alerts with
     non-UUID ids.
2. The collar beeped BREACH for about 2 hours with no GPS fix.
   - Evidence: in `firmware/logs/device-monitor-260924-005213.log`, all 999
     uplinks had fix=0 and all 968 replies were state=2.
   - Root cause: the collar applied any reply and kept `lastState` forever, and
     the server answered no-fix readings from the stale stored `animal_status`.
3. Any user could promote themselves to admin in the repo `schema.sql`: the role
   came from sign-up metadata, and UPDATE on `profiles.role` was allowed. The
   live export shows this had already been closed by hand on the live database.
4. Realtime died silently after the hourly TOKEN_REFRESHED.
   - Root cause: the effect depended on `load`, which changed with every new
     profile object.
   - realtime-js `channel()` then returned the old, closing channel with the same
     name.
5. The anon key could read every animal's live position through
   `latest_livestock_locations`: the view had no `security_invoker` and had anon
   grants. It is still open on live until `schema.sql` is run.
   - Also, `get_geofences_geojson` was SECURITY DEFINER, which bypasses RLS.
6. There were no background or push alerts. The siren was foreground-only, and
   server alerts never triggered it.
7. EAS builds would have run in demo mode, and the demo sign-in links shipped in
   production builds.
8. Hardware: an AMS1117 regulator on a LiPo cannot make 3.3 V.

High and medium: firmware
- The gateway did a fresh TLS handshake for every reading, with no timeouts. It
  blocked for up to 120 s, could not hear LoRa meanwhile, and degraded after
  about 20 min. This was an open item in the 2026-09-24 entry.
- Collar IDs came from the low 32 bits of the MAC: 3 vendor-prefix bytes plus 1
  chip byte. That gave any two collars a 1-in-256 chance of the same ID.
- Robustness:
  - Neither board had a watchdog.
  - A failed radio init hung forever.
  - The blocking `endPacket()` could spin forever.
  - A wedged radio never recovered.
- GPS data quality:
  - Battery was hardcoded to 85.
  - `gpsEpoch` was always 0.
  - There was no fix-quality gate.
  - There were no GPS diagnostics.
  - The GPS UART starved during the 4 s reply wait (256 B buffer).
- The gateway could crash parsing a reply, sent 0,0 and battery 85 instead of
  null, used `setInsecure()` for TLS, and had no buffering while WiFi was down.
- Test sketches still drove GPIO2, and lora_tx/lora_rx used library defaults, so
  they could not talk to the real link.
- Found by reliability-engineer in the new code:
  - The gateway boot-looped when WiFi was up but the internet was down. Every
    fresh boot hit 5 transport failures and restarted, losing the queue each
    time.
  - A stale RX_DONE flag, which nothing on the LoRa 0.8.0 transmit path clears,
    could make a collar read its own uplink as a reply. It could also corrupt a
    gateway uplink. Both need 2 or more collars.
  - The response body read had no overall deadline.
  - A batch that kept getting server errors was retried forever.
  - The upload task's creation was never checked.

High and medium: database (from the live export)
- The live `ingest_telemetry` dropped readings from unregistered collars, so a
  re-flashed collar with its new ID would have been silently dropped.
- The live function stored battery NULL as 0 %, which raised false low-battery
  alerts. The v2 gateway sends null.
- One bad reading failed the whole batch.
- Live users could not resolve alerts at all: they had no UPDATE on `alerts`. The
  repo schema instead let them rewrite any column.
- anon could write `spatial_ref_sys`, which is owned by supabase_admin with RLS
  off. pg_graphql exposed the same table.
- The live `detect_geofence_events` had several faults:
  - The warning used the first covering fence, not the deepest.
  - It used `ST_Contains`.
  - It had no hysteresis.
  - It de-duplicated alerts over 10 minutes instead of on transitions.
  - It never auto-resolved alerts.
- Correction to the 2026-09-24 entry's open item: the live function already
  treated breach as outside *every* active fence.
- Found in the final review: `/rest/v1/spatial%5Fref%5Fsys` got past the guard,
  because PostgREST decodes the path after the guard's check.

High and medium: app
- The auth listener awaited inside `onAuthStateChange`, and the app bounced to
  login when offline.
- Writes ignored errors, and screens closed anyway.
- Every location insert triggered a full reload, and the alerts query was
  unbounded.
- `app.json` declared unused background location, audio and foreground services.
- The phone GPS check fired the livestock siren.
- Status was hard-coded as "Online".
- Emergency Disable did nothing.
- Tapping an alert resolved it.
- Fence save always sent buffer 30 and active true.
- Found in code review:
  - An expired session made RLS return empty lists with no error. That wiped the
    farm view and let the breach tracker resolve every breach.
  - Push token registration failed under RLS on a phone that had changed user.
  - Signing out one phone signed out every phone.
- Found during testing: web-preview fence points were NaN, because
  react-native-web's Pressable event has no `locationX`.

Field tools
- Windows that crossed midnight matched nothing.
- PDR used max−min seq over the whole window, so collar reboots and seq wraps
  broke it.
  - The 24 Sep log has 4 collar reboots (seq resets at log lines 1578, 1820,
    1828 and 2012).
  - The whole-log output was "sent 1767, PDR 49.6%" with 123 false duplicates.
- A window with a single packet crashed the range table.
- "sats in view" was mislabelled; the value is satellites used.
- `queries.sql`:
  - Q2 counted duplicate rows as delivered.
  - The collar ID was hard-coded.
  - The Q5 reference point was pre-filled, and about 2.5 m off.
  - `timestamp` was used as the receipt time.

**Fixes applied:**

Critical (each maps to the numbered bug above)
1. Contract fence rules in both the trigger and the app, and the app is now
   server-authoritative.
   - Verified: app fence harness 24/24 (5 km outside = breach; deepest fence;
     hysteresis both ways), database tests, and 9 mutants caught.
   - Not verified on a phone.
2. Collar gate on seq and fix, silent after 3 cycles, and the server returns SAFE
   for no fix, stale fix or mute.
   - Verified: build; database test 8; mutants for stale, mute and no-fix caught.
   - The new analyzer reproduces the original failure on the real log.
   - Not verified on hardware.
3. `handle_new_user` always creates `'staff'`, and UPDATE is limited to
   `(full_name, farm_name)`.
   - Verified: database tests and mutants.
   - Not yet applied to live.
4. Realtime effect keyed on profile id, unique channel names, a status callback
   with reload, and the profile re-fetched only on user change.
   - Verified: tsc and lint, and a logic review only.
   - Needs an on-device check running longer than 1 h.
5. View made `security_invoker` and revoked from anon; `get_geofences_geojson`
   made INVOKER.
   - Verified: database test 13, verify rows, and mutants.
   - Live stays exposed until `schema.sql` is run.
6. pg_net push trigger plus app registration.
   - Verified with a pg_net stand-in: channels, URL and header are correct, and a
     failing push still stores the alert.
   - Needs Firebase and a new development build.
7. EAS environments per profile, and demo links only when Supabase is not
   configured.
   - Verified: browser smoke test, and the bundle contains no Supabase keys.
   - Needs `eas env:set`.
8. AMS1117: documented in `firmware/README.md` only (hardware change).

Other fixes, verified by build, tsc, lint and tests unless stated
- Gateway TLS and heap: two tasks, batching and one persistent connection with
  bounded timeouts.
  - Verified: body reader 13/13 host tests; timeout units checked against the
    core source; live certificate chain verifies against the bundle.
  - Heap stability on hardware was not measured.
- Reliability fixes:
  - Boot loop: a restart now also needs the server to have been reached since
    boot, or 15 min of uptime. The queue is kept.
  - Stale RX_DONE: one `parsePacket()` before the collar listens, and after the
    gateway's reply TX.
  - Body deadline: `readBody()` with one 3000 ms budget.
  - Server errors: halve the batch, then drop.
  - Task creation is checked.
  - Log lines from the upload task are single writes.
  - The split/drop path was checked by reading and build only; it was not
    host-tested.
- Percent-encoding bypass: the guard refuses any path containing `%` for anon
  and authenticated. Verified by test 13 and a new mutant.
- Mutation gap: direct privilege and catalog assertions added. The final run
  caught 29/29.
- App review items:
  - A session check runs before every loader.
  - Push tokens are registered through the `register_push_token` RPC.
  - Sign-out uses `signOut({ scope: 'local' })`.
- Web NaN points: fixed with `pressPoint` and `openRing`. Verified in the
  browser.
- LoRa private methods: the TX deadline uses the public `beginPacket()`, which
  returns 0 while transmitting. The planned register read-back was dropped.
- expo-doctor: `npx expo install --fix` applied the 7 patch bumps.

Deviations from the approved plan
- `eas env:set` instead of `eas env:create`: eas-cli 24.x has only `env:set`.
- The gateway restarts on transport failures only, not on any 5 failures. A final
  −11 on a fresh connection counts as a server error.
- ts=0 de-duplication adds a 10 s fix-time slack, so a collar that reboots within
  120 s isn't dropped.
- Push tokens go through the `register_push_token` RPC, not a direct upsert.
- `collars` realtime also applies INSERT. Unresolved alerts are capped at 500.

Status of the 2026-09-24 entry's open items
- `SEND_INTERVAL_MS` is back to 3000 (`collar.cpp:40`). The outcome of the 30 s
  diagnostic is Not recorded.
- The outdoor GPS fix problem was not re-tested: this session did no hardware
  work. The new `gps_ok`/`gps_rst` bits report GPS health.
- Gateway TLS degradation: fixed in code, not verified on hardware. The gateway
  brownout cause was not addressed.
- Now fixed in the repo: multi-fence logic, `schema.sql` versus live, battery 85
  and `gpsEpoch` 0.
- `gateway_ingest.sql` deleted.
- DIO0 on GPIO2 is still a hardware item.
- Per git, the firmware that entry listed as untracked was committed in 78b8485
  at 04:31 HKT, about 48 minutes after that entry was written.

**Verified results:** All checks ran locally. Nothing ran on hardware, a phone,
or the live database.
- Firmware:
  - All 8 PlatformIO environments build.
  - Collar and gateway show 0 warnings with `-Wall -Wextra -Wformat=2`.
  - Gateway: 53,424 B RAM / 950,693 B flash. Collar: 47,892 B RAM / 874,717 B
    flash.
  - The battery-sense and GPS power-save flags also compile.
- Host tests:
  - Packet sizes are 21 and 8 bytes.
  - `gpsEpoch` date math matches libc `timegm` on 2,688 dates (2024–2079).
  - Gateway body reader: 13/13.
- TLS: the live Supabase chain (leaf → WE1 → GTS Root R4, checked 2026-09-25)
  verifies against the bundle. All 6 root fingerprints match the macOS root
  store.
- App:
  - tsc: 0 errors.
  - `expo lint`: 0 errors, 0 warnings (49 files).
  - expo-doctor: 21/21.
  - Fence harness: 24/24.
  - Config introspection: iOS asks for when-in-use location only, and the
    Android background permissions are removed.
  - Android and web JS bundles export.
  - Demo-mode browser smoke test: 0 JS exceptions.
- Database (PGlite 0.5.8, PostgreSQL 18.3 + PostGIS 3.6.2; live runs 17.6):
  - Sequence run: 00 → schema → schema again (idempotent) → tests.
  - ALL TESTS PASSED on a live-shaped copy (1009 fixes, 18 alerts, 13 open; data
    unchanged) and on a fresh project, with and without a pg_net stand-in.
  - 29/29 mutants caught.
  - A 64-reading batch takes 22 ms; the same batch retried takes 3 ms.
  - `rekey_collar.sql` merges correctly and can be re-run.
  - The pre-request path matrix passes.
  - `verify_setup.sql`: all rows OK or INFO except pg_net and pg_cron, which
    PGlite does not ship.
  - The "Test the alarm without hardware" SQL works.
- Field tools:
  - `--selftest`: 107/107 on Python 3.14.7 and 3.9.6.
  - The real 24 Sep log is unchanged (same md5), and the headline numbers match
    the original script: 999 RX, 3 reboots/banners, 25 upload failures, fix=1 on
    0/999, RSSI median −81, SNR median 3.8.
  - Only the PDR changes: 999 received / 1239 sent = 80.6 % over 5 segments with
    4 collar reboots. It was 49.6 %, and an independent recomputation agrees.
  - That whole-log figure mixes gateway reboots, the range walk and long gaps. It
    is not a link metric and was not entered in `SUMMARY.md`.
  - Windows without a reboot are unchanged: 01:20–01:25 is 86.4 %, and
    00:52–00:54 is 71.4 %.
- The coordinator's final re-check of the whole tree (firmware build, tsc, lint,
  database tests, analyzer self-test) passed.

**Open items:**

User actions, in order:
1. In the Supabase SQL Editor, run `00_enum_values.sql` → `schema.sql` →
   `verify_setup.sql` → `tests/geofence_tests.sql`.
2. Turn off public sign-ups.
3. Run the two curl checks, plain and percent-encoded. Expect 401/403
   "forbidden".
4. Run README "Reset stale state": on live, Bessie is stuck in breach with 13
   open alerts.
5. Flash the gateway, then the collar. Both must be reflashed for protocol v2.
6. Run `rekey_collar.sql` with the old ID FT-EC82C34C and the new ID the collar
   prints at boot.
7. Bench tests.
8. `npm install`, then:
   - `eas env:set` for the `EXPO_PUBLIC_*` variables.
   - Set up Firebase, `google-services.json` and the FCM V1 key.
   - Build a new development build.
9. Phone tests using "Test the alarm without hardware".
10. Hardware:
    - Move DIO0 from GPIO2 to GPIO26.
    - Replace the AMS1117 with an RT9080/ME6211-class LDO.
    - Fit the 100k/100k battery divider and set `BATTERY_SENSE_ENABLED 1`.
11. Real icon artwork and your own bundle ID before any store upload.
12. Commit the work.

Accepted limitations:
- A gateway restart loses its queue.
- Long Supabase outages drop the oldest readings.
- The buzzer boot click is left until a bench test.
- GPS power-save and battery sensing are untested.
- Farm coordinates remain in public git history.
- 17 npm audit findings (16 moderate, 1 high) are left.

The tally counts 4 accepted limitations. Which of these six make up those 4 is
Not recorded.

Not verifiable locally; confirm on the live project:
- Whether pg_net and pg_cron can be created from SQL, and the pg_net
  `http_post` signature.
- Whether `ALTER ROLE authenticator SET pgrst.db_pre_request` works as
  `postgres`, and PostgREST honours it.
- Realtime delivery.
- The REVOKE on `spatial_ref_sys`. It is expected to be a no-op; the guard is the
  real protection.
- Behaviour on PostgreSQL 17.6 specifically.

Remaining risks:
- A reading that fails inside the database is skipped, with only a Postgres-log
  WARNING.
- No-fix readings are not stored in `location_logs`.
- A GPS that goes silent has no automatic recovery.
- Heap and stack headroom at runtime are unmeasured.
- v2 log parsing has been checked against synthetic logs only; the first real v2
  gateway log still needs a run.

## 2026-09-27 HKT (evening) — v2.5 deployment and bench bring-up: live DB migrated, both boards flashed, collar re-keyed, loose radio wiring found and fixed

**Context:** Live Supabase database, collar firmware, gateway firmware and docs.
This session follows the v2.5 fix entry from earlier the same day. The user
worked through that entry's deployment runbook (user actions 1–7) while Claude
guided each step. Exact start and end times are Not recorded; this entry was
written at 2026-09-27 22:13 HKT. The user did all database steps in the Supabase
SQL Editor.

Bench setup:
- The gateway was on USB (`/dev/cu.usbserial-1120`) and the collar on a second
  USB port.
- The boards sat about 30 cm apart.
- Indoors, so there was no GPS fix.

**Changes made:**

Live database (done by the user)
- Ran the read-only `export_live_schema.sql` first. Its output is kept
  git-ignored as `app/supabase/live_schema_dump.csv` and `.json`. The export
  showed:
  - The self-promote-to-admin hole had already been closed by hand on live:
    `handle_new_user` hard-codes `'staff'` and there is no table UPDATE on
    `profiles`.
  - anon could still read `latest_livestock_locations`.
  - The live ingest dropped unknown collar IDs and stored a null battery as 0 %.
  - Authenticated users had no UPDATE on `alerts`.
  - pg_net and pg_cron were available but not installed.
  - PostGIS was in `public`.
  - Git cross-check: both dump files on disk are dated 2026-09-26 21:19 HKT.
    That matches the Step 0 export in the earlier entry, so a re-run this
    session is not reflected on disk.
- Ran `00_enum_values.sql` → `schema.sql` → `verify_setup.sql` →
  `tests/geofence_tests.sql`.
- Turned off public sign-ups under Authentication.
- Ran the README "Reset stale state" snippet. Bessie had been stuck in breach
  with 13 open alerts.
- Ran `rekey_collar.sql` to move the collar from its old ID FT-EC82C34C to its
  new ID FT-F0FDEC82.

Flashing
- Flashed the gateway first, then the collar, both with protocol v2.
- The collar printed its new ID FT-F0FDEC82 at boot, alongside its v1 ID
  FT-EC82C34C.
- During debugging, both boards were flashed with the `lora_diag` diagnostic
  and then flashed back. The gateway was re-flashed with gateway firmware at
  the end.

Firmware (`firmware/`)
- `src/lora_link.h` `loraSend()` now uses the library's blocking `endPacket()`.
  This waits for TxDone, as v1 did.
  - Removed `LORA_TX_TIMEOUT_MS` and the `whileWaiting` parameter, which fed the
    GPS during TX.
  - Updated the callers in `collar.cpp`, `gateway.cpp` and `test_lora_tx.cpp`.
  - The task watchdog (collar 30 s, gateway 60 s) now covers a frozen radio.
- `src/pins.h`: new `LORA_TX_DBM`, default 17. `loraBeginLink()` applies it.
- Replies moved from inverted IQ to normal IQ on both boards: `gateway.cpp`
  `sendReplies` and `collar.cpp` `sendCycle`. The comments in `packet.h` and
  `test_lora_rx.cpp` were updated to match.
- `collar.cpp` now logs `RX ignored: …` for any non-matching packet heard in
  its reply window.
- New `src/test_lora_diag.cpp` (env `lora_diag`):
  - Reads the SX1278's `RegOpMode` and `RegIrqFlags` directly during sends.
  - Its default mode is a power sweep: 3 sends at each of 2, 5, 8, 11, 14 and
    17 dBm.
- New `src/test_lora_listen.cpp` (env `lora_listen`):
  - Receives continuously.
  - Reports good and corrupted packets, headers, and the strongest and weakest
    RSSI.
  - Written but not needed in the end.
- `platformio.ini`: new envs `lora_diag` and `lora_listen`.
- These changes reverse three items from the earlier 2026-09-27 entry, per git:
  - The 1 s `loraSend()` TX deadline is gone; the send now blocks.
  - Replies no longer use inverted IQ; they use normal IQ.
  - The GPS is no longer read during TX airtime.

Docs
- `app/supabase/README.md` and the header of `tests/geofence_tests.sql`: added a
  note to answer the SQL Editor's RLS warning with "Run without RLS".
- `app/supabase/README.md`: section "Test the alarm without hardware", with SQL
  blocks for inside → 40 m outside → inside.
  - Discrepancy: the earlier 2026-09-27 entry already lists this section as
    written and verified.
  - The file is untracked, so git cannot show what changed this session. The
    file is dated 15:37 HKT, after that entry was written at 13:10.
- `firmware/README.md`:
  - Programs table: added `lora_diag` and `lora_listen`.
  - Updated the `lora_link.h` description.
  - Loose-wiring warning under the SX1278 wiring table.
  - `LORA_TX_DBM` added to the radio settings table.
  - The IQ paragraph now describes normal IQ.
  - New troubleshooting rows:
    - `TASK_WDT` with no TX lines.
    - "no reply" while the gateway is sending.
    - `ignored packet len=8 ver=70`.
    - Corrected `len=21 ver=1` (v1 collars).
  - New section "Found and fixed on the bench (27 Sep 2026)".
  - Updated the folder layout.
- The "FarmTrack Fix Report" artifact (claude.ai, outside the repo) was
  updated. Git cannot verify this. Changes:
  - Now 90 findings.
  - Progress banner.
  - Bench results.
  - Hardware card "Make the radio wiring permanent".

**Errors encountered:**
1. The Supabase SQL Editor showed a "creates tables without enabling Row Level
   Security" warning on `tests/geofence_tests.sql`.
2. The collar logged `TX seq=N` every cycle, but the gateway heard nothing for
   over 5 minutes. Its only output was
   `radio re-init: no uplink heard for 5 minutes`.
3. After the switch to a blocking send:
   - The collar printed no TX lines.
   - The watchdog restarted it about every 30 s (reset reason `TASK_WDT`;
     `task_wdt: loopTask (CPU 1)`).
   - `lora_tx` on the collar board also stopped after `LoRa OK`.
4. `lora_diag` on the collar board:
   - Every 2 dBm send finished, with TxDone after 124 ms.
   - Every 17 dBm send reset the radio chip within 1–59 ms. `RegOpMode` read
     0x6B (FSK), meaning the chip had reset.
   - Later even 2 dBm failed, and the radio stopped answering on SPI ("LoRa not
     initialised").
5. After the wiring was re-seated and the collar firmware restored:
   - The gateway heard every uplink and logged
     `TX reply state=0 seq=N dev=F0FDEC82` each cycle.
   - The collar still logged `no reply from gateway` every cycle.
   - The gateway's first upload took 4396 ms (TLS handshake), which led to
     `reply late, skipped seq=0`.
6. After the move to normal IQ and the new `RX ignored` logging, the collar
   still heard nothing.
7. At boot the collar prints
   `E (4900) ledc: ledc_get_duty(745): LEDC is not initialized`.

**Bugs found:**
- The live database's state before migration, as shown by the export, matches
  the earlier entry. The findings are listed under Changes made.
- The v2 `loraSend()` hid failed sends. It started each send with
  `endPacket(true)` and polled `beginPacket()` to detect completion, and it
  reported "sent" although nothing went out. This masked the real fault
  (errors 2 and 3).
  - Discrepancy: the new comment in `lora_link.h` describes a different
    mechanism. It says the early "done" answer itself cut packets off.
  - The non-blocking version was not re-tested after the wiring was fixed, so
    which account is complete is not established.
- A loose jumper on the collar radio was the root cause of errors 3–6. It
  happened twice:
  - First, poor contact on the radio's wiring. Voltage was lost across the bad
    contact at TX current, which reset the SX1278 and finally stopped SPI
    (error 4).
  - Second, the collar's receiver heard nothing (error 6) until the user pushed
    a radio jumper wire in deeper. Which wire it was is Not recorded.
- The LEDC boot error is cosmetic. `collar.cpp` `setup()` already contains a
  `tone()`/`noTone()` LEDC warm-up meant to suppress this message. That code
  has been present since 78b8485, and the message still appears.

**Fixes applied:**
1. RLS warning: answered "Run without RLS". The test file's only table is a
   temporary scratch table that its final ROLLBACK removes. Verified: the test
   run passed.
2. Live database: `00_enum_values.sql` and `schema.sql` applied the v2 schema,
   including the anon view revoke, the auto-registering ingest, null battery
   and the alerts UPDATE grant. Verified by the tests and the API guard checks
   (see Verified results).
3. `loraSend()` made blocking. Verified only indirectly: after the wiring fix
   the gateway heard every uplink.
4. Loose wiring, first time: the user unplugged and re-seated the radio's
   VCC/GND and other wires. Verified: the `lora_diag` power sweep passed 3/3 at
   every level from 2 to 17 dBm, three sweeps in a row.
5. Normal-IQ replies and `RX ignored` logging: these alone did not fix error 6.
   `lora_diag` on the gateway board showed its transmitter working, 3/3 at
   every power level.
6. Loose wiring, second time: the user pushed a radio jumper in deeper.
   - Verified: the collar immediately logged the gateway's diag packets as
     `RX ignored: reply ver=70 id=49442D54 seq=18241 state=2/5/8/11/14/17`.
     This is the "FT-DIAG" payload parsed as a reply.
   - Normal IQ was kept: it is proven in v1, and the size/id/seq checks already
     prevent cross-collar mix-ups.
   - Whether inverted IQ would also work with the wire fixed was not re-tested.
7. LEDC boot error: not fixed.

**Verified results:**
- Live database:
  - `tests/geofence_tests.sql`: "ALL TESTS PASSED".
  - The `verify_setup.sql` output is Not recorded.
  - Whether pg_net and pg_cron were installed by `schema.sql` is Not recorded.
- API guard, tested with curl and the anon key:
  - `DELETE /rest/v1/spatial_ref_sys` returned HTTP 401
    `{"code":"42501","message":"forbidden"}`.
  - The percent-encoded `/rest/v1/spatial%5Fref%5Fsys` returned the same.
  - `POST /rest/v1/rpc/ingest_telemetry` with a wrong key returned 403 "invalid
    gateway key", so the guard does not block the gateway path.
  - This confirms on live that the PostgREST pre-request guard is active, which
    the earlier entry listed as unverifiable locally.
- `rekey_collar.sql` returned one row: Bessie, 1009 positions, 18 alerts.
- "Test the alarm without hardware" was run in the local PGlite + PostGIS
  harness only:
  - It went grazing → breach with exactly one new alert → grazing with that
    alert resolved.
  - Whether it was run on live is Not recorded.
- Gateway boot: reset reason POWERON, `LoRa OK`, WiFi connected at rssi −69.
- `lora_diag` passed on both boards:
  - Collar board, after the re-seat: 3/3 at 2, 5, 8, 11, 14 and 17 dBm, three
    sweeps in a row.
  - Gateway board: 3/3 at every level.
- Bench link (about 30 cm, indoors):
  - The gateway heard every uplink: `RX from F0FDEC82`, RSSI −38, SNR about
    11.5–13.8.
  - Uploads were OK: the first took 4396 ms (TLS handshake), then about
    174–233 ms, with one at 1287 ms.
  - Heap stayed flat at 175 KB, maxblk 94196. How long this was observed is
    Not recorded.
- Full loop verified on hardware: collar → LoRa → gateway → Supabase → gateway
  → LoRa → collar.
  - Every cycle the collar logged `TX seq=180 …` / `RX state=0 seq=180` /
    `reply ignored: this uplink had no usable fix`.
  - The buzzer stayed silent.
  - This is the first hardware verification of the earlier entry's critical
    bug 2 fix (no-fix replies are no longer applied).
- Builds: `pio run` succeeds for collar, gateway, lora_tx, lora_rx, lora_diag
  and lora_listen after the changes.
  - Git cross-check: the collar, lora_tx, lora_rx and lora_diag binaries on disk
    are dated 22:11 HKT. The gateway binary is dated 22:08 and lora_listen
    22:06.
  - Those two predate the last `packet.h` edit (22:11:25, a comment only), so
    the artifacts do not by themselves confirm that those two were rebuilt
    after it.
- Not verified: a GPS fix, a real breach beep, and anything on a phone.

**Open items:**
- Make the collar radio's wiring permanent (solder or locking connectors)
  before field use. Its jumpers had to be re-seated twice in this session.
- The gateway's 30-minute soak (flat heap, no `reply late`) has not been
  formally run.
- The phone-app runbook has not been started: `npm install`, `eas env:set`,
  Firebase/FCM, a new development build, and the phone tests.
- An outdoor GPS fix and a real breach beep are still untested.
- Inverted-IQ replies with the wiring fixed are untested. Normal IQ is in use.
- The LEDC boot error line is cosmetic, and the existing warm-up does not
  suppress it.
- pg_net and pg_cron status on live, and realtime delivery, are unconfirmed.
- The status of the earlier entry's hardware items (DIO0 to GPIO26, AMS1117
  replacement, battery divider) is Not recorded.
- Everything is still uncommitted. The last commit is 78b8485. Tracked files
  outside this log: 60 modified and 19 deleted, +13,509 / −5,255 lines. There
  are 15 untracked files, which includes the two new diagnostics.

## 2026-09-27 HKT (late) — v2.5 phone app deployed and verified; gateway soak passed

**Context:** App (Expo/EAS, Firebase/FCM), live Supabase, and the gateway
(soak only). This continues the evening deployment entry: the user worked
through the runbook's phone-app phase while Claude guided each step. The boards
stayed running on the bench (indoors, no GPS fix). Exact start and end times are
Not recorded; this entry was written at 2026-09-27 23:23 HKT.

**Changes made:**

The user did all of these; no code changes were reported.
- `cd app && npm install`: up to date. npm reports 17 known audit findings and
  an install-scripts warning for `unrs-resolver` (an ESLint helper). Both were
  left as documented.
- EAS environment variables on project @farmtrack/farmtrack, for development,
  preview and production (eas-cli 24.8.0 `env:set --non-interactive`):
  - `EXPO_PUBLIC_SUPABASE_URL` (plaintext).
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_MAPTILER_KEY` (sensitive).
  - Set from `app/.env` by a loop that never printed the values.
- Firebase:
  - Project created (project id farmtrack-3516f) with an Android app
    `com.farmtrack.app`.
  - `app/google-services.json` saved. Claude verified its package name and that
    `expo config` resolves `googleServicesFile`. Uploaded as EAS file variable
    `GOOGLE_SERVICES_JSON` (secret, all three environments).
  - FCM V1 service-account key generated and uploaded with `eas credentials`
    (Android → Google Service Account → FCM V1), assigned to
    `com.farmtrack.app`. The key file stays in the user's Downloads folder,
    outside the repo.
- New development build: `eas build --profile development --platform android`.
  It finished and was installed on the user's Android phone from the build link
  (emulator declined).
- `npx expo start` on the Mac. The user signed in with email/password and
  allowed notifications.
- The "FarmTrack Fix Report" artifact (claude.ai, outside the repo; git cannot
  verify) was updated: 81 fixed in code, 1 needs user action (icon artwork and
  bundle ID), 4 hardware, 4 accepted.
- Git cross-check:
  - Diff totals are unchanged from the evening entry: outside this log, 60
    modified and 19 deleted tracked files, +13,509 / −5,255 lines; 15 untracked
    files. `app/package-lock.json` is dated 22:14 HKT (the install).
  - `app/google-services.json` is git-ignored (`app/.gitignore` line 50) and
    dated 22:28 HKT.
  - `firmware/src/lora_link.h` (untracked) is dated 22:17:56 HKT and the
    collar, gateway and lora_tx binaries 22:18. That was Claude correcting the
    comment above `loraSend()` so it states the proven cause (the non-blocking
    probe reported "sent" while the radio was resetting on a loose supply wire,
    hiding the fault) instead of the earlier guess that the probe cut packets
    off - the discrepancy noted in the evening entry. Comment-only; all six
    radio environments were rebuilt to confirm they still compile. Neither
    board was re-flashed, and neither needed to be.

**Errors encountered:**
- The Supabase SQL Editor showed its "creates tables without enabling Row Level
  Security" warning on the INSERT-only alarm-test SQL. This is a false positive:
  the statement creates no tables.

**Bugs found:**
- None.

**Fixes applied:**
- None. The RLS warning needed no fix; it was answered "Run without RLS".

**Verified results:**
- Supabase check query: `push_tokens` count = 1 (the phone registered through
  `register_push_token`), pg_net installed, Bessie = grazing.
- Breach test ("Test the alarm without hardware" block B, a fix 40 m outside
  Fence 1 at `now()`): with the phone locked, a FarmTrack breach push
  notification arrived on the lock screen within seconds. This is the first
  end-to-end confirmation of DB trigger → pg_net → Expo push → FCM → phone.
- Recovery test (block A, a fix inside the fence): the app cleared the alarm by
  itself and Bessie's marker turned green. Whether the Alerts tab showed the
  breach alert as resolved is Not recorded.
- Emergency Disable: tapping it showed the "Collars silenced until HH:MM"
  banner. Whether Unmute was tapped afterwards is Not recorded (Claude asked the
  user to tap it).
- Gateway soak, at collar seq ~1550 (well over an hour of running):
  - Every upload succeeded: mostly ~180–390 ms, occasionally 575 ms and
    1232 ms.
  - No `reply late`, no `upload failed`, no restarts.
  - maxblk unchanged at 94196 bytes. Heap steady at ~169.6–169.9 KB after
    settling from 175.4 KB at startup.
  - Stack free: loop=6252, upload=6480.
  - RSSI −40 to −42, SNR ~10.5–13.8.
  - Collar replies all state=0 (no fix indoors).

**Open items:**
- Live updates on the phone past the one-hour login refresh are not yet
  observed.
- An outdoor GPS fix and a real breach beep on the collar are still untested.
- Make the collar radio wiring permanent.
- Hardware: DIO0 → GPIO26, low-dropout regulator, battery divider.
- Icon artwork and our own bundle ID before any store upload. Changing the
  bundle ID also needs a new Firebase Android app entry and a new build.
- Everything is still uncommitted. The last commit is 78b8485.
